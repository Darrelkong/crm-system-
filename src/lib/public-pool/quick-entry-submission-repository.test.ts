import assert from "node:assert/strict";
import { after, before, describe, it, type TestContext } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import {
  QUICK_ENTRY_ROW_STATUS_CREATED,
  QUICK_ENTRY_ROW_STATUS_DUPLICATE,
  QUICK_ENTRY_ROW_STATUS_FAILED,
  QUICK_ENTRY_ROW_STATUS_INVALID,
  QUICK_ENTRY_SUBMISSION_CLEANUP_LIMIT,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES,
  QUICK_ENTRY_SUBMISSION_LEASE_SECONDS,
  QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED,
  QUICK_ENTRY_SUBMISSION_STATUS_PROCESSING,
} from "@/lib/public-pool/quick-entry-submission-constants";
import {
  buildInsertQuickEntrySubmissionRowStatement,
  cleanupExpiredQuickEntrySubmissions,
  completeQuickEntrySubmission,
  createOrLoadSubmission,
  getQuickEntrySubmissionStaleBefore,
  getSubmissionByActorAndClientId,
  getSubmissionRowByClientRowId,
  insertTerminalSubmissionRow,
  listSubmissionRows,
  QuickEntrySubmissionError,
} from "@/lib/public-pool/quick-entry-submission-repository";

const QE3A_ACTOR_A = "qe3aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const QE3A_ACTOR_B = "qe3bbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const QE3A_EMAIL_A = "qe3a-actor-a@crm.test.local";
const QE3A_EMAIL_B = "qe3a-actor-b@crm.test.local";
const SUB_ID_1 = "550e8400-e29b-41d4-a716-446655440001";
const SUB_ID_2 = "550e8400-e29b-41d4-a716-446655440002";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let tablesReady = false;
let d1: {
  prepare: (query: string) => {
    all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
    first: <T = Record<string, unknown>>() => Promise<T | null>;
  };
};

async function assertIdempotencyTablesExist(): Promise<boolean> {
  const all = await d1
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all<{ name: string }>();
  const names = new Set((all.results ?? []).map((row) => row.name));
  return (
    names.has("public_pool_quick_entry_submissions") &&
    names.has("public_pool_quick_entry_submission_rows")
  );
}

async function cleanup() {
  await db
    .delete(schema.publicPoolQuickEntrySubmissions)
    .where(
      inArray(schema.publicPoolQuickEntrySubmissions.actorUserId, [
        QE3A_ACTOR_A,
        QE3A_ACTOR_B,
      ]),
    );
  await db.delete(schema.users).where(eq(schema.users.id, QE3A_ACTOR_A));
  await db.delete(schema.users).where(eq(schema.users.id, QE3A_ACTOR_B));
}

async function ensureActors() {
  const now = new Date().toISOString();
  for (const user of [
    {
      id: QE3A_ACTOR_A,
      email: QE3A_EMAIL_A,
      displayName: "QE3A Actor A",
      role: "staff" as const,
    },
    {
      id: QE3A_ACTOR_B,
      email: QE3A_EMAIL_B,
      displayName: "QE3A Actor B",
      role: "admin" as const,
    },
  ]) {
    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(schema.users).values({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        isActive: 1,
        passwordHash: "INVALID_HASH_TEST_ONLY",
        failedLoginAttempts: 0,
        lockedUntil: null,
        mustChangePassword: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

describe("quick-entry submission repository — DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: new URL("../../../wrangler.jsonc", import.meta.url).pathname,
    });
    db = drizzle(proxy.env.DB, { schema });
    d1 = proxy.env.DB as typeof d1;
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);

    tablesReady = await assertIdempotencyTablesExist();
    if (!tablesReady) return;

    await cleanup();
    await ensureActors();
  });

  after(async () => {
    if (tablesReady) {
      await cleanup();
    }
    bindTestDatabase(null);
    if (disposeProxy) await disposeProxy();
  });

  it("requires additive migration 0034 tables on local D1", () => {
    if (!tablesReady) {
      assert.fail(
        "Local D1 missing public_pool_quick_entry_submissions / " +
          "public_pool_quick_entry_submission_rows. " +
          "getPlatformProxy does not auto-apply " +
          "drizzle/migrations/0034_public_pool_quick_entry_idempotency.sql. " +
          "QUICK-ENTRY-3A forbids agent-run wrangler d1 migrations apply; " +
          "authorize local apply separately before DB suite.",
      );
    }
  });

  it("schema has expected columns and no PII columns", async function (this: TestContext) {
    if (!tablesReady) {
      this.skip();
      return;
    }

    const subCols = await d1
      .prepare("PRAGMA table_info(public_pool_quick_entry_submissions)")
      .all<{ name: string }>();
    const rowCols = await d1
      .prepare("PRAGMA table_info(public_pool_quick_entry_submission_rows)")
      .all<{ name: string }>();
    const subNames = new Set((subCols.results ?? []).map((c) => c.name));
    const rowNames = new Set((rowCols.results ?? []).map((c) => c.name));

    for (const required of [
      "id",
      "actor_user_id",
      "submission_id",
      "request_hash",
      "status",
      "row_count",
      "created_count",
      "duplicate_count",
      "invalid_count",
      "failed_count",
      "created_at",
      "updated_at",
      "processing_started_at",
      "completed_at",
      "expires_at",
    ]) {
      assert.equal(subNames.has(required), true, required);
    }
    for (const required of [
      "id",
      "submission_db_id",
      "client_row_id",
      "row_index",
      "status",
      "error_code",
      "duplicate_field",
      "customer_id",
      "customer_code",
      "customer_name",
      "created_at",
      "updated_at",
    ]) {
      assert.equal(rowNames.has(required), true, required);
    }

    for (const forbidden of [
      "phone",
      "phone_country_code",
      "wechat",
      "wechat_id",
      "notes",
      "requested_project",
      "source_remark",
      "raw_request",
      "request_json",
    ]) {
      assert.equal(subNames.has(forbidden), false, forbidden);
      assert.equal(rowNames.has(forbidden), false, forbidden);
    }
  });

  it("createOrLoad: create, processing, conflict, completed replay, actor scope", async function (this: TestContext) {
    if (!tablesReady) {
      this.skip();
      return;
    }
    await cleanup();
    await ensureActors();

    const now = new Date("2026-07-22T00:00:00.000Z");
    const created = await createOrLoadSubmission({
      actorUserId: QE3A_ACTOR_A,
      submissionId: SUB_ID_1,
      requestHash: HASH_A,
      rowCount: 2,
      now,
      db,
    });
    assert.equal(created.state, "created");
    if (created.state !== "created") return;

    const again = await createOrLoadSubmission({
      actorUserId: QE3A_ACTOR_A,
      submissionId: SUB_ID_1,
      requestHash: HASH_A,
      rowCount: 2,
      now: new Date(now.getTime() + 10_000),
      db,
    });
    assert.equal(again.state, "processing");
    if (again.state === "processing") {
      assert.ok(again.retryAfterSeconds >= 1);
    }

    await assert.rejects(
      () =>
        createOrLoadSubmission({
          actorUserId: QE3A_ACTOR_A,
          submissionId: SUB_ID_1,
          requestHash: HASH_B,
          rowCount: 2,
          now,
          db,
        }),
      (err: unknown) =>
        err instanceof QuickEntrySubmissionError &&
        err.errorCode ===
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    );

    const otherActor = await createOrLoadSubmission({
      actorUserId: QE3A_ACTOR_B,
      submissionId: SUB_ID_1,
      requestHash: HASH_A,
      rowCount: 1,
      now,
      db,
    });
    assert.equal(otherActor.state, "created");

    await insertTerminalSubmissionRow({
      submissionDbId: created.submission.id,
      clientRowId: "r1",
      rowIndex: 0,
      status: QUICK_ENTRY_ROW_STATUS_INVALID,
      errorCode: "QUICK_ENTRY_CONTACT_REQUIRED",
      now,
      db,
    });
    await insertTerminalSubmissionRow({
      submissionDbId: created.submission.id,
      clientRowId: "r2",
      rowIndex: 1,
      status: QUICK_ENTRY_ROW_STATUS_DUPLICATE,
      errorCode: "QUICK_ENTRY_DUPLICATE_PHONE",
      duplicateField: "phone",
      now,
      db,
    });
    const completed = await completeQuickEntrySubmission({
      submissionDbId: created.submission.id,
      now,
      db,
    });
    assert.equal(completed.submission.status, QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED);
    assert.equal(completed.submission.invalidCount, 1);
    assert.equal(completed.submission.duplicateCount, 1);
    assert.equal(completed.rows.length, 2);
    assert.equal(completed.rows[0]?.clientRowId, "r1");
    assert.equal(completed.rows[1]?.clientRowId, "r2");

    const replay = await createOrLoadSubmission({
      actorUserId: QE3A_ACTOR_A,
      submissionId: SUB_ID_1,
      requestHash: HASH_A,
      rowCount: 2,
      now,
      db,
    });
    assert.equal(replay.state, "completed");
    if (replay.state === "completed") {
      assert.equal(replay.rows.length, 2);
    }

    const scoped = await getSubmissionByActorAndClientId({
      actorUserId: QE3A_ACTOR_B,
      submissionId: SUB_ID_1,
      db,
    });
    assert.ok(scoped);
    assert.notEqual(scoped!.id, created.submission.id);
  });

  it("stale reclaim is CAS and concurrent losers reload", async function (this: TestContext) {
    if (!tablesReady) {
      this.skip();
      return;
    }
    await cleanup();
    await ensureActors();

    const start = new Date("2026-07-22T01:00:00.000Z");
    const created = await createOrLoadSubmission({
      actorUserId: QE3A_ACTOR_A,
      submissionId: SUB_ID_2,
      requestHash: HASH_A,
      rowCount: 1,
      now: start,
      db,
    });
    assert.equal(created.state, "created");
    if (created.state !== "created") return;

    const freshNow = new Date(
      start.getTime() + (QUICK_ENTRY_SUBMISSION_LEASE_SECONDS - 10) * 1000,
    );
    const fresh = await createOrLoadSubmission({
      actorUserId: QE3A_ACTOR_A,
      submissionId: SUB_ID_2,
      requestHash: HASH_A,
      rowCount: 1,
      now: freshNow,
      db,
    });
    assert.equal(fresh.state, "processing");

    const staleNow = new Date(
      start.getTime() + (QUICK_ENTRY_SUBMISSION_LEASE_SECONDS + 5) * 1000,
    );
    assert.ok(
      created.submission.processingStartedAt <=
        getQuickEntrySubmissionStaleBefore(staleNow),
    );

    const [first, second] = await Promise.all([
      createOrLoadSubmission({
        actorUserId: QE3A_ACTOR_A,
        submissionId: SUB_ID_2,
        requestHash: HASH_A,
        rowCount: 1,
        now: staleNow,
        db,
      }),
      createOrLoadSubmission({
        actorUserId: QE3A_ACTOR_A,
        submissionId: SUB_ID_2,
        requestHash: HASH_A,
        rowCount: 1,
        now: staleNow,
        db,
      }),
    ]);

    const states = [first.state, second.state].sort();
    assert.ok(states.includes("reclaimed"));
    assert.ok(
      states.includes("reclaimed") ||
        states.includes("processing") ||
        states.filter((s) => s === "reclaimed").length === 1,
    );
    const reclaimCount = [first, second].filter(
      (r) => r.state === "reclaimed",
    ).length;
    assert.equal(reclaimCount, 1);

    const winner = first.state === "reclaimed" ? first : second;
    assert.equal(winner.state, "reclaimed");
    if (winner.state === "reclaimed") {
      assert.notEqual(
        winner.submission.processingStartedAt,
        created.submission.processingStartedAt,
      );
    }
  });

  it("terminal rows: statuses, uniques, no overwrite, ordered list", async function (this: TestContext) {
    if (!tablesReady) {
      this.skip();
      return;
    }
    await cleanup();
    await ensureActors();
    const now = new Date("2026-07-22T02:00:00.000Z");
    const created = await createOrLoadSubmission({
      actorUserId: QE3A_ACTOR_A,
      submissionId: SUB_ID_1,
      requestHash: HASH_A,
      rowCount: 4,
      now,
      db,
    });
    assert.equal(created.state, "created");
    if (created.state !== "created") return;
    const sid = created.submission.id;

    await insertTerminalSubmissionRow({
      submissionDbId: sid,
      clientRowId: "r0",
      rowIndex: 0,
      status: QUICK_ENTRY_ROW_STATUS_INVALID,
      errorCode: "QUICK_ENTRY_CUSTOMER_NAME_REQUIRED",
      now,
      db,
    });
    await insertTerminalSubmissionRow({
      submissionDbId: sid,
      clientRowId: "r1",
      rowIndex: 1,
      status: QUICK_ENTRY_ROW_STATUS_DUPLICATE,
      errorCode: "QUICK_ENTRY_DUPLICATE_WECHAT",
      duplicateField: "wechatId",
      now,
      db,
    });
    await insertTerminalSubmissionRow({
      submissionDbId: sid,
      clientRowId: "r2",
      rowIndex: 2,
      status: QUICK_ENTRY_ROW_STATUS_FAILED,
      errorCode: "QUICK_ENTRY_CUSTOMER_CREATE_FAILED",
      now,
      db,
    });
    await insertTerminalSubmissionRow({
      submissionDbId: sid,
      clientRowId: "r3",
      rowIndex: 3,
      status: QUICK_ENTRY_ROW_STATUS_CREATED,
      customerId: "cust-1",
      customerCode: "EF000001",
      customerName: "测试客户",
      now,
      db,
    });

    const listed = await listSubmissionRows({ submissionDbId: sid, db });
    assert.deepEqual(
      listed.map((r) => r.clientRowId),
      ["r0", "r1", "r2", "r3"],
    );

    const same = await insertTerminalSubmissionRow({
      submissionDbId: sid,
      clientRowId: "r0",
      rowIndex: 0,
      status: QUICK_ENTRY_ROW_STATUS_INVALID,
      errorCode: "QUICK_ENTRY_CUSTOMER_NAME_REQUIRED",
      now,
      db,
    });
    assert.equal(same.state, "existing");

    await assert.rejects(
      () =>
        insertTerminalSubmissionRow({
          submissionDbId: sid,
          clientRowId: "r0",
          rowIndex: 0,
          status: QUICK_ENTRY_ROW_STATUS_FAILED,
          errorCode: "OTHER",
          now,
          db,
        }),
      (err: unknown) =>
        err instanceof QuickEntrySubmissionError &&
        err.errorCode ===
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ROW_CONFLICT,
    );

    await assert.rejects(
      () =>
        insertTerminalSubmissionRow({
          submissionDbId: sid,
          clientRowId: "rX",
          rowIndex: 0,
          status: QUICK_ENTRY_ROW_STATUS_INVALID,
          errorCode: "X",
          now,
          db,
        }),
      (err: unknown) => err instanceof QuickEntrySubmissionError,
    );

    await assert.rejects(
      () =>
        insertTerminalSubmissionRow({
          submissionDbId: sid,
          clientRowId: "r0",
          rowIndex: 9,
          status: QUICK_ENTRY_ROW_STATUS_INVALID,
          errorCode: "X",
          now,
          db,
        }),
      (err: unknown) => err instanceof QuickEntrySubmissionError,
    );

    await assert.rejects(
      () =>
        insertTerminalSubmissionRow({
          submissionDbId: sid,
          clientRowId: "bad-created",
          rowIndex: 10,
          status: QUICK_ENTRY_ROW_STATUS_CREATED,
          now,
          db,
        }),
      (err: unknown) =>
        err instanceof QuickEntrySubmissionError &&
        err.errorCode ===
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.ROW_PAYLOAD_INVALID,
    );

    await assert.rejects(
      () =>
        insertTerminalSubmissionRow({
          submissionDbId: sid,
          clientRowId: "bad-dup",
          rowIndex: 11,
          status: QUICK_ENTRY_ROW_STATUS_DUPLICATE,
          errorCode: "QUICK_ENTRY_DUPLICATE_PHONE",
          now,
          db,
        }),
      (err: unknown) =>
        err instanceof QuickEntrySubmissionError &&
        err.errorCode ===
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.ROW_PAYLOAD_INVALID,
    );
  });

  it("row statement participates in atomic db.batch rollback", async function (this: TestContext) {
    if (!tablesReady) {
      this.skip();
      return;
    }
    await cleanup();
    await ensureActors();
    const now = new Date("2026-07-22T03:00:00.000Z");
    const created = await createOrLoadSubmission({
      actorUserId: QE3A_ACTOR_A,
      submissionId: SUB_ID_1,
      requestHash: HASH_A,
      rowCount: 1,
      now,
      db,
    });
    assert.equal(created.state, "created");
    if (created.state !== "created") return;

    const rowStmt = buildInsertQuickEntrySubmissionRowStatement(db, {
      submissionDbId: created.submission.id,
      clientRowId: "atomic-r1",
      rowIndex: 0,
      status: QUICK_ENTRY_ROW_STATUS_INVALID,
      errorCode: "QUICK_ENTRY_CONTACT_REQUIRED",
      nowIso: now.toISOString(),
    });
    const conflictId = created.submission.id;
    const failStmt = db.insert(schema.publicPoolQuickEntrySubmissions).values({
      id: conflictId,
      actorUserId: QE3A_ACTOR_A,
      submissionId: "550e8400-e29b-41d4-a716-446655449999",
      requestHash: HASH_B,
      status: QUICK_ENTRY_SUBMISSION_STATUS_PROCESSING,
      rowCount: 1,
      createdCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      failedCount: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      processingStartedAt: now.toISOString(),
      completedAt: null,
      expiresAt: now.toISOString(),
    });

    await assert.rejects(async () => {
      await db.batch([
        rowStmt,
        failStmt,
      ] as unknown as Parameters<typeof db.batch>[0]);
    });

    const orphan = await getSubmissionRowByClientRowId({
      submissionDbId: created.submission.id,
      clientRowId: "atomic-r1",
      db,
    });
    assert.equal(orphan, null);
  });

  it("complete requires full row set and is concurrent-safe", async function (this: TestContext) {
    if (!tablesReady) {
      this.skip();
      return;
    }
    await cleanup();
    await ensureActors();
    const now = new Date("2026-07-22T04:00:00.000Z");
    const created = await createOrLoadSubmission({
      actorUserId: QE3A_ACTOR_A,
      submissionId: SUB_ID_1,
      requestHash: HASH_A,
      rowCount: 2,
      now,
      db,
    });
    assert.equal(created.state, "created");
    if (created.state !== "created") return;

    await assert.rejects(
      () =>
        completeQuickEntrySubmission({
          submissionDbId: created.submission.id,
          now,
          db,
        }),
      (err: unknown) =>
        err instanceof QuickEntrySubmissionError &&
        err.errorCode ===
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_INCOMPLETE,
    );

    await insertTerminalSubmissionRow({
      submissionDbId: created.submission.id,
      clientRowId: "c0",
      rowIndex: 0,
      status: QUICK_ENTRY_ROW_STATUS_CREATED,
      customerId: "c-0",
      customerCode: "EF100000",
      customerName: "甲",
      now,
      db,
    });
    await insertTerminalSubmissionRow({
      submissionDbId: created.submission.id,
      clientRowId: "c1",
      rowIndex: 1,
      status: QUICK_ENTRY_ROW_STATUS_INVALID,
      errorCode: "QUICK_ENTRY_PROJECT_REQUIRED",
      now,
      db,
    });

    const [a, b] = await Promise.all([
      completeQuickEntrySubmission({
        submissionDbId: created.submission.id,
        now,
        db,
      }),
      completeQuickEntrySubmission({
        submissionDbId: created.submission.id,
        now,
        db,
      }),
    ]);
    assert.equal(a.submission.status, QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED);
    assert.equal(b.submission.status, QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED);
    assert.equal(a.submission.createdCount, 1);
    assert.equal(a.submission.invalidCount, 1);
    assert.equal(a.rows.length, 2);
  });

  it("cleanup deletes expired submissions and cascades rows only", async function (this: TestContext) {
    if (!tablesReady) {
      this.skip();
      return;
    }
    await cleanup();
    await ensureActors();

    const past = new Date("2026-01-01T00:00:00.000Z");
    const future = new Date("2026-12-01T00:00:00.000Z");
    const created = await createOrLoadSubmission({
      actorUserId: QE3A_ACTOR_A,
      submissionId: SUB_ID_1,
      requestHash: HASH_A,
      rowCount: 1,
      now: past,
      db,
    });
    assert.equal(created.state, "created");
    if (created.state !== "created") return;

    await insertTerminalSubmissionRow({
      submissionDbId: created.submission.id,
      clientRowId: "exp-r",
      rowIndex: 0,
      status: QUICK_ENTRY_ROW_STATUS_INVALID,
      errorCode: "X",
      now: past,
      db,
    });

    await db
      .update(schema.publicPoolQuickEntrySubmissions)
      .set({ expiresAt: "2026-01-02T00:00:00.000Z" })
      .where(eq(schema.publicPoolQuickEntrySubmissions.id, created.submission.id));

    const keep = await createOrLoadSubmission({
      actorUserId: QE3A_ACTOR_A,
      submissionId: SUB_ID_2,
      requestHash: HASH_B,
      rowCount: 1,
      now: future,
      db,
    });
    assert.equal(keep.state, "created");

    const result = await cleanupExpiredQuickEntrySubmissions({
      now: new Date("2026-06-01T00:00:00.000Z"),
      limit: 100,
      db,
    });
    assert.ok(result.deletedCount >= 1);
    assert.ok(result.deletedCount <= QUICK_ENTRY_SUBMISSION_CLEANUP_LIMIT);

    const gone = await getSubmissionByActorAndClientId({
      actorUserId: QE3A_ACTOR_A,
      submissionId: SUB_ID_1,
      db,
    });
    assert.equal(gone, null);
    const orphanRows = await db
      .select()
      .from(schema.publicPoolQuickEntrySubmissionRows)
      .where(
        and(
          eq(
            schema.publicPoolQuickEntrySubmissionRows.clientRowId,
            "exp-r",
          ),
        ),
      );
    assert.equal(orphanRows.length, 0);

    const kept = await getSubmissionByActorAndClientId({
      actorUserId: QE3A_ACTOR_A,
      submissionId: SUB_ID_2,
      db,
    });
    assert.ok(kept);

    const actorStillThere = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, QE3A_ACTOR_A))
      .limit(1);
    assert.equal(actorStillThere.length, 1);
  });
});
