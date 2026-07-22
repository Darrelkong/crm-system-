import assert from "node:assert/strict";
import { after, before, describe, it, type TestContext } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import {
  QUICK_ENTRY_ROW_STATUS_CREATED,
  QUICK_ENTRY_ROW_STATUS_INVALID,
  QUICK_ENTRY_SUBMISSION_ERROR_CODES,
  QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED,
  QUICK_ENTRY_SUBMISSION_STATUS_PROCESSING,
} from "@/lib/public-pool/quick-entry-submission-constants";
import {
  buildInsertQuickEntrySubmissionRowForLeaseStatement,
  completeQuickEntrySubmissionForLease,
  createOrLoadSubmission,
  getSubmissionRowByClientRowId,
  insertTerminalSubmissionRowForLease,
  listSubmissionRows,
  QuickEntrySubmissionError,
  renewQuickEntrySubmissionLease,
} from "@/lib/public-pool/quick-entry-submission-repository";

const ACTOR = "qe3bleas-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const ACTOR_B = "qe3bleas-bbbb-4bbb-8bbb-bbbbbbbbbb02";
const SUB = "550e8400-e29b-41d4-a716-4466554400c1";
const HASH = "d".repeat(64);

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let tablesReady = false;

async function cleanup() {
  await db
    .delete(schema.publicPoolQuickEntrySubmissions)
    .where(
      inArray(schema.publicPoolQuickEntrySubmissions.actorUserId, [
        ACTOR,
        ACTOR_B,
      ]),
    );
  await db.delete(schema.users).where(eq(schema.users.id, ACTOR));
  await db.delete(schema.users).where(eq(schema.users.id, ACTOR_B));
}

async function ensureActors() {
  const now = new Date().toISOString();
  for (const user of [
    {
      id: ACTOR,
      email: "qe3b-lease-a@crm.test.local",
      displayName: "QE3B Lease A",
      role: "staff" as const,
    },
    {
      id: ACTOR_B,
      email: "qe3b-lease-b@crm.test.local",
      displayName: "QE3B Lease B",
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

describe("quick-entry submission lease guards — DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: new URL("../../../wrangler.jsonc", import.meta.url).pathname,
    });
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    const tables = await (
      proxy.env.DB as {
        prepare: (q: string) => {
          all: <T>() => Promise<{ results: T[] }>;
        };
      }
    )
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all<{ name: string }>();
    const names = new Set((tables.results ?? []).map((r) => r.name));
    tablesReady =
      names.has("public_pool_quick_entry_submissions") &&
      names.has("public_pool_quick_entry_submission_rows");
    if (tablesReady) {
      await cleanup();
      await ensureActors();
    }
  });

  after(async () => {
    if (tablesReady) await cleanup();
    bindTestDatabase(null);
    if (disposeProxy) await disposeProxy();
  });

  it("lease-bound invalid row insert succeeds; wrong actor／lease／completed fail", async function (this: TestContext) {
    if (!tablesReady) {
      this.skip();
      return;
    }
    await cleanup();
    await ensureActors();
    const now = new Date("2026-07-22T15:00:00.000Z");
    const created = await createOrLoadSubmission({
      actorUserId: ACTOR,
      submissionId: SUB,
      requestHash: HASH,
      rowCount: 2,
      now,
      db,
    });
    assert.equal(created.state, "created");
    if (created.state !== "created") return;
    const lease = created.submission.processingStartedAt;

    const inserted = await insertTerminalSubmissionRowForLease({
      actorUserId: ACTOR,
      submissionId: SUB,
      expectedProcessingStartedAt: lease,
      clientRowId: "lease-r0",
      rowIndex: 0,
      status: QUICK_ENTRY_ROW_STATUS_INVALID,
      errorCode: "QUICK_ENTRY_CONTACT_REQUIRED",
      now,
      db,
    });
    assert.equal(inserted.state, "inserted");

    await assert.rejects(
      () =>
        insertTerminalSubmissionRowForLease({
          actorUserId: ACTOR_B,
          submissionId: SUB,
          expectedProcessingStartedAt: lease,
          clientRowId: "lease-r1",
          rowIndex: 1,
          status: QUICK_ENTRY_ROW_STATUS_INVALID,
          errorCode: "QUICK_ENTRY_CONTACT_REQUIRED",
          now,
          db,
        }),
      (err: unknown) =>
        err instanceof QuickEntrySubmissionError &&
        (err.errorCode ===
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_NOT_FOUND ||
          err.errorCode ===
            QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_LEASE_LOST),
    );

    await assert.rejects(
      () =>
        insertTerminalSubmissionRowForLease({
          actorUserId: ACTOR,
          submissionId: SUB,
          expectedProcessingStartedAt: "1999-01-01T00:00:00.000Z",
          clientRowId: "lease-r1",
          rowIndex: 1,
          status: QUICK_ENTRY_ROW_STATUS_INVALID,
          errorCode: "QUICK_ENTRY_CONTACT_REQUIRED",
          now,
          db,
        }),
      (err: unknown) =>
        err instanceof QuickEntrySubmissionError &&
        err.errorCode === QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_LEASE_LOST,
    );

    await insertTerminalSubmissionRowForLease({
      actorUserId: ACTOR,
      submissionId: SUB,
      expectedProcessingStartedAt: lease,
      clientRowId: "lease-r1",
      rowIndex: 1,
      status: QUICK_ENTRY_ROW_STATUS_INVALID,
      errorCode: "QUICK_ENTRY_CONTACT_REQUIRED",
      now,
      db,
    });
    await completeQuickEntrySubmissionForLease({
      actorUserId: ACTOR,
      submissionId: SUB,
      expectedProcessingStartedAt: lease,
      now,
      db,
    });

    await assert.rejects(
      () =>
        insertTerminalSubmissionRowForLease({
          actorUserId: ACTOR,
          submissionId: SUB,
          expectedProcessingStartedAt: lease,
          clientRowId: "lease-r2",
          rowIndex: 0,
          status: QUICK_ENTRY_ROW_STATUS_INVALID,
          errorCode: "QUICK_ENTRY_CONTACT_REQUIRED",
          now,
          db,
        }),
      (err: unknown) =>
        err instanceof QuickEntrySubmissionError &&
        err.errorCode ===
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ALREADY_COMPLETED,
    );
  });

  it("renew lease CAS succeeds; stale token fails; complete sparse rejects", async function (this: TestContext) {
    if (!tablesReady) {
      this.skip();
      return;
    }
    await cleanup();
    await ensureActors();
    const now = new Date("2026-07-22T16:00:00.000Z");
    const created = await createOrLoadSubmission({
      actorUserId: ACTOR,
      submissionId: SUB,
      requestHash: HASH,
      rowCount: 2,
      now,
      db,
    });
    assert.equal(created.state, "created");
    if (created.state !== "created") return;
    const lease = created.submission.processingStartedAt;

    const later = new Date("2026-07-22T16:01:00.000Z");
    const renewed = await renewQuickEntrySubmissionLease({
      actorUserId: ACTOR,
      submissionId: SUB,
      expectedProcessingStartedAt: lease,
      now: later,
      db,
    });
    assert.equal(renewed.state, "renewed");
    assert.equal(renewed.processingStartedAt, later.toISOString());

    await assert.rejects(
      () =>
        renewQuickEntrySubmissionLease({
          actorUserId: ACTOR,
          submissionId: SUB,
          expectedProcessingStartedAt: lease,
          now: later,
          db,
        }),
      (err: unknown) =>
        err instanceof QuickEntrySubmissionError &&
        err.errorCode === QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_LEASE_LOST,
    );

    await insertTerminalSubmissionRowForLease({
      actorUserId: ACTOR,
      submissionId: SUB,
      expectedProcessingStartedAt: renewed.processingStartedAt,
      clientRowId: "sparse-0",
      rowIndex: 0,
      status: QUICK_ENTRY_ROW_STATUS_INVALID,
      errorCode: "QUICK_ENTRY_CONTACT_REQUIRED",
      now: later,
      db,
    });

    await assert.rejects(
      () =>
        completeQuickEntrySubmissionForLease({
          actorUserId: ACTOR,
          submissionId: SUB,
          expectedProcessingStartedAt: renewed.processingStartedAt,
          now: later,
          db,
        }),
      (err: unknown) =>
        err instanceof QuickEntrySubmissionError &&
        err.errorCode ===
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_INCOMPLETE,
    );

    // sparse index 1 missing; also reject wrong actor complete
    await assert.rejects(
      () =>
        completeQuickEntrySubmissionForLease({
          actorUserId: ACTOR_B,
          submissionId: SUB,
          expectedProcessingStartedAt: renewed.processingStartedAt,
          now: later,
          db,
        }),
      (err: unknown) =>
        err instanceof QuickEntrySubmissionError &&
        err.errorCode ===
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_NOT_FOUND,
    );
  });

  it("lease failure rolls back customer+audit+row batch", async function (this: TestContext) {
    if (!tablesReady) {
      this.skip();
      return;
    }
    await cleanup();
    await ensureActors();
    const now = new Date("2026-07-22T17:00:00.000Z");
    const created = await createOrLoadSubmission({
      actorUserId: ACTOR,
      submissionId: SUB,
      requestHash: HASH,
      rowCount: 1,
      now,
      db,
    });
    assert.equal(created.state, "created");
    if (created.state !== "created") return;

    const customerId = "qe3b-cust-aaaa-4aaa-8aaa-aaaaaaaaaa99";
    const customerStmt = db.insert(schema.customers).values({
      id: customerId,
      customerCode: "EF999901",
      customerName: "原子回滚客户",
      customerType: "individual",
      phoneCountryCode: "+86",
      phone: "13920001111",
      wechatId: null,
      email: null,
      source: "public_pool_quick_entry",
      sourceRemark: null,
      requestedProjectName: "测试项目名称",
      notes: null,
      salesStage: "contacted",
      status: "public_pool",
      ownerId: null,
      releaserUserId: null,
      poolEnteredAt: now.toISOString(),
      poolReason: null,
      releasedBy: null,
      previousOwnerId: null,
      claimedBy: null,
      claimedAt: null,
      poolLeftAt: null,
      createdBy: ACTOR,
      updatedBy: ACTOR,
      deletedAt: null,
      deletedBy: null,
      deletedReason: null,
      isPinned: 0,
      pinnedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const auditStmt = db.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      userId: ACTOR,
      action: "customer.created.public_pool_direct",
      entityType: "customer",
      entityId: customerId,
      ipAddress: null,
      userAgent: null,
      metadata: JSON.stringify({ probe: true }),
      createdAt: now.toISOString(),
    });
    const badRow = buildInsertQuickEntrySubmissionRowForLeaseStatement(db, {
      actorUserId: ACTOR,
      submissionId: SUB,
      expectedProcessingStartedAt: "1999-01-01T00:00:00.000Z",
      clientRowId: "atomic-fail",
      rowIndex: 0,
      status: QUICK_ENTRY_ROW_STATUS_CREATED,
      customerId,
      customerCode: "EF999901",
      customerName: "原子回滚客户",
      now,
    });

    await assert.rejects(async () => {
      await db.batch([
        customerStmt,
        auditStmt,
        badRow,
      ] as unknown as Parameters<typeof db.batch>[0]);
    });

    const customer = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId))
      .limit(1);
    assert.equal(customer.length, 0);
    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, customerId));
    assert.equal(audits.length, 0);
    const row = await getSubmissionRowByClientRowId({
      submissionDbId: created.submission.id,
      clientRowId: "atomic-fail",
      db,
    });
    assert.equal(row, null);
    assert.equal(created.submission.status, QUICK_ENTRY_SUBMISSION_STATUS_PROCESSING);
  });

  it("terminal row is immutable under lease insert", async function (this: TestContext) {
    if (!tablesReady) {
      this.skip();
      return;
    }
    await cleanup();
    await ensureActors();
    const now = new Date("2026-07-22T18:00:00.000Z");
    const created = await createOrLoadSubmission({
      actorUserId: ACTOR,
      submissionId: SUB,
      requestHash: HASH,
      rowCount: 1,
      now,
      db,
    });
    assert.equal(created.state, "created");
    if (created.state !== "created") return;
    const lease = created.submission.processingStartedAt;

    await insertTerminalSubmissionRowForLease({
      actorUserId: ACTOR,
      submissionId: SUB,
      expectedProcessingStartedAt: lease,
      clientRowId: "imm-1",
      rowIndex: 0,
      status: QUICK_ENTRY_ROW_STATUS_INVALID,
      errorCode: "QUICK_ENTRY_CONTACT_REQUIRED",
      now,
      db,
    });

    const again = await insertTerminalSubmissionRowForLease({
      actorUserId: ACTOR,
      submissionId: SUB,
      expectedProcessingStartedAt: lease,
      clientRowId: "imm-1",
      rowIndex: 0,
      status: QUICK_ENTRY_ROW_STATUS_INVALID,
      errorCode: "QUICK_ENTRY_CONTACT_REQUIRED",
      now,
      db,
    });
    assert.equal(again.state, "existing");

    await assert.rejects(
      () =>
        insertTerminalSubmissionRowForLease({
          actorUserId: ACTOR,
          submissionId: SUB,
          expectedProcessingStartedAt: lease,
          clientRowId: "imm-1",
          rowIndex: 0,
          status: QUICK_ENTRY_ROW_STATUS_CREATED,
          customerId: "x",
          customerCode: "EF1",
          customerName: "n",
          now,
          db,
        }),
      (err: unknown) =>
        err instanceof QuickEntrySubmissionError &&
        err.errorCode ===
          QUICK_ENTRY_SUBMISSION_ERROR_CODES.SUBMISSION_ROW_CONFLICT,
    );

    const rows = await listSubmissionRows({
      submissionDbId: created.submission.id,
      db,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, QUICK_ENTRY_ROW_STATUS_INVALID);
  });
});
