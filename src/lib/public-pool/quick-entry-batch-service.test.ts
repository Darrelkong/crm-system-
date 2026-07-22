import assert from "node:assert/strict";
import { after, before, describe, it, type TestContext } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY } from "@/lib/constants/customer-sources";
import { processQuickEntryCustomerSubmission } from "@/lib/public-pool/quick-entry-batch-service";
import { QUICK_ENTRY_CUSTOMER_AUDIT_ACTION } from "@/lib/public-pool/quick-entry-customer-service";
import {
  QUICK_ENTRY_SUBMISSION_ERROR_CODES,
  QUICK_ENTRY_SUBMISSION_LEASE_SECONDS,
  QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED,
  QUICK_ENTRY_SUBMISSION_STATUS_PROCESSING,
} from "@/lib/public-pool/quick-entry-submission-constants";
import { hashQuickEntrySubmissionPayload } from "@/lib/public-pool/quick-entry-submission-hash";
import {
  createOrLoadSubmission,
  getSubmissionByActorAndClientId,
  insertTerminalSubmissionRowForLease,
  listSubmissionRows,
  renewQuickEntrySubmissionLease,
} from "@/lib/public-pool/quick-entry-submission-repository";
import { QUICK_ENTRY_ROW_STATUS_INVALID } from "@/lib/public-pool/quick-entry-submission-constants";

const ACTOR_A = "qe3bbtch-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const ACTOR_B = "qe3bbtch-bbbb-4bbb-8bbb-bbbbbbbbbb02";
const EMAIL_A = "qe3b-batch-a@crm.test.local";
const EMAIL_B = "qe3b-batch-b@crm.test.local";
const SUB_1 = "550e8400-e29b-41d4-a716-4466554400d1";
const SUB_2 = "550e8400-e29b-41d4-a716-4466554400d2";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let tablesReady = false;
let actorA: User;
let actorB: User;
const createdCustomerIds: string[] = [];

async function cleanup() {
  if (createdCustomerIds.length > 0) {
    await db
      .delete(schema.auditLogs)
      .where(inArray(schema.auditLogs.entityId, createdCustomerIds));
    await db
      .delete(schema.customers)
      .where(inArray(schema.customers.id, createdCustomerIds));
    createdCustomerIds.length = 0;
  }
  await db
    .delete(schema.publicPoolQuickEntrySubmissions)
    .where(
      inArray(schema.publicPoolQuickEntrySubmissions.actorUserId, [
        ACTOR_A,
        ACTOR_B,
      ]),
    );
  await db
    .delete(schema.customers)
    .where(
      and(
        eq(schema.customers.createdBy, ACTOR_A),
        eq(schema.customers.source, PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY),
      ),
    );
  await db
    .delete(schema.customers)
    .where(
      and(
        eq(schema.customers.createdBy, ACTOR_B),
        eq(schema.customers.source, PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY),
      ),
    );
  await db.delete(schema.users).where(eq(schema.users.id, ACTOR_A));
  await db.delete(schema.users).where(eq(schema.users.id, ACTOR_B));
}

async function ensureActors() {
  const now = new Date().toISOString();
  for (const user of [
    {
      id: ACTOR_A,
      email: EMAIL_A,
      displayName: "QE3B Batch A",
      role: "staff" as const,
    },
    {
      id: ACTOR_B,
      email: EMAIL_B,
      displayName: "QE3B Batch B",
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
  actorA = (
    await db.select().from(schema.users).where(eq(schema.users.id, ACTOR_A)).limit(1)
  )[0] as User;
  actorB = (
    await db.select().from(schema.users).where(eq(schema.users.id, ACTOR_B)).limit(1)
  )[0] as User;
}

function trackCreated(ids: string[]) {
  createdCustomerIds.push(...ids);
}

describe("processQuickEntryCustomerSubmission — DB", () => {
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

  it("creates mixed batch with order／summary／no PII in results", async function (this: TestContext) {
    if (!tablesReady) {
      this.skip();
      return;
    }
    await cleanup();
    await ensureActors();

    // Seed a DB duplicate phone
    const seed = await processQuickEntryCustomerSubmission({
      actor: actorA,
      submissionId: "550e8400-e29b-41d4-a716-4466554400e1",
      rows: [
        {
          clientRowId: "seed1",
          customerName: "种子客户",
          phone: "13930001001",
          requestedProjectName: "加拿大移民项目",
        },
      ],
      now: new Date("2026-07-22T19:00:00.000Z"),
      db,
    });
    assert.equal(seed.ok, true);
    if (seed.ok) {
      trackCreated(
        seed.results
          .filter((r) => r.status === "created")
          .map((r) => r.customerId),
      );
    }

    const result = await processQuickEntryCustomerSubmission({
      actor: actorA,
      submissionId: SUB_1,
      rows: [
        {
          clientRowId: "r1",
          customerName: "批次客户一",
          phone: "13930002001",
          requestedProjectName: "加拿大移民项目",
        },
        {
          clientRowId: "r2",
          customerName: "A",
          phone: "13930002002",
          requestedProjectName: "加拿大移民项目",
        },
        {
          clientRowId: "r3",
          customerName: "批次客户三",
          phone: "13930002001",
          requestedProjectName: "加拿大移民项目",
        },
        {
          clientRowId: "r4",
          customerName: "批次客户四",
          phone: "13930001001",
          requestedProjectName: "加拿大移民项目",
        },
      ],
      now: new Date("2026-07-22T19:05:00.000Z"),
      db,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.replayed, false);
    assert.equal(result.results.length, 4);
    assert.equal(result.results[0]?.status, "created");
    assert.equal(result.results[1]?.status, "invalid");
    assert.equal(result.results[2]?.status, "duplicate");
    assert.equal(result.results[3]?.status, "duplicate");
    assert.equal(result.summary.created, 1);
    assert.equal(result.summary.invalid, 1);
    assert.equal(result.summary.duplicates, 2);
    assert.equal(result.summary.failed, 0);

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("13930002001"), false);
    assert.equal(serialized.includes("phoneCountryCode"), false);
    assert.equal(serialized.includes("requestedProjectName"), false);
    assert.equal(serialized.includes("submissionDbId"), false);
    assert.equal(serialized.includes("requestHash"), false);

    if (result.results[0]?.status === "created") {
      trackCreated([result.results[0].customerId]);
      const customer = (
        await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, result.results[0].customerId))
          .limit(1)
      )[0];
      assert.equal(customer?.status, "public_pool");
      assert.equal(customer?.ownerId, null);
      assert.equal(customer?.source, PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY);
      assert.equal(customer?.deletedAt, null);
      assert.equal(customer?.releaserUserId, null);
      assert.equal(customer?.claimedBy, null);

      const audits = await db
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.entityId, result.results[0].customerId),
            eq(schema.auditLogs.action, QUICK_ENTRY_CUSTOMER_AUDIT_ACTION),
          ),
        );
      assert.equal(audits.length, 1);
      const meta = audits[0]?.metadata ?? "";
      assert.equal(meta.includes("13930002001"), false);
      assert.equal(meta.includes('"phone"'), false);
      assert.equal(meta.includes("wechat"), false);
      assert.equal(meta.includes("notes"), false);
    }

    const submission = await getSubmissionByActorAndClientId({
      actorUserId: ACTOR_A,
      submissionId: SUB_1,
      db,
    });
    assert.equal(submission?.status, QUICK_ENTRY_SUBMISSION_STATUS_COMPLETED);
    const rows = await listSubmissionRows({
      submissionDbId: submission!.id,
      db,
    });
    for (const row of rows) {
      assert.equal("phone" in row, false);
      assert.equal(JSON.stringify(row).includes("139300"), false);
    }
  });

  it("replays completed submission and isolates actors", async function (this: TestContext) {
    if (!tablesReady) {
      this.skip();
      return;
    }
    await cleanup();
    await ensureActors();
    const now = new Date("2026-07-22T20:00:00.000Z");
    const first = await processQuickEntryCustomerSubmission({
      actor: actorA,
      submissionId: SUB_1,
      rows: [
        {
          clientRowId: "only",
          customerName: "重放客户",
          phone: "13930003001",
          requestedProjectName: "加拿大移民项目",
        },
      ],
      now,
      db,
    });
    assert.equal(first.ok, true);
    if (first.ok && first.results[0]?.status === "created") {
      trackCreated([first.results[0].customerId]);
    }

    const replay = await processQuickEntryCustomerSubmission({
      actor: actorA,
      submissionId: SUB_1,
      rows: [
        {
          clientRowId: "only",
          customerName: "重放客户",
          phone: "13930003001",
          requestedProjectName: "加拿大移民项目",
        },
      ],
      now: new Date("2026-07-22T20:01:00.000Z"),
      db,
    });
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.equal(replay.replayed, true);
      assert.equal(replay.results[0]?.status, "created");
    }

    const conflict = await processQuickEntryCustomerSubmission({
      actor: actorA,
      submissionId: SUB_1,
      rows: [
        {
          clientRowId: "only",
          customerName: "重放客户改名",
          phone: "13930003001",
          requestedProjectName: "加拿大移民项目",
        },
      ],
      now: new Date("2026-07-22T20:02:00.000Z"),
      db,
    });
    assert.equal(conflict.ok, false);
    if (!conflict.ok) {
      assert.equal(
        conflict.errorCode,
        QUICK_ENTRY_SUBMISSION_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      );
    }

    const otherActor = await processQuickEntryCustomerSubmission({
      actor: actorB,
      submissionId: SUB_1,
      rows: [
        {
          clientRowId: "only",
          customerName: "另一操作者",
          phone: "13930003002",
          requestedProjectName: "加拿大移民项目",
        },
      ],
      now: new Date("2026-07-22T20:03:00.000Z"),
      db,
    });
    assert.equal(otherActor.ok, true);
    if (otherActor.ok && otherActor.results[0]?.status === "created") {
      trackCreated([otherActor.results[0].customerId]);
    }
  });

  it("resumes after partial rows without recreating", async function (this: TestContext) {
    if (!tablesReady) {
      this.skip();
      return;
    }
    await cleanup();
    await ensureActors();
    const now = new Date("2026-07-22T21:00:00.000Z");
    const resumeRows = [
      {
        clientRowId: "p1",
        customerName: "恢复客户一",
        phone: "13930004001",
        phoneCountryCode: "+86",
        wechatId: null,
        requestedProjectName: "加拿大移民项目",
        initialFollowUpNote: null,
        supplementalNote: null,
      },
      {
        clientRowId: "p2",
        customerName: "恢复客户二",
        phone: "13930004002",
        phoneCountryCode: "+86",
        wechatId: null,
        requestedProjectName: "加拿大移民项目",
        initialFollowUpNote: null,
        supplementalNote: null,
      },
    ] as const;
    const created = await createOrLoadSubmission({
      actorUserId: ACTOR_A,
      submissionId: SUB_2,
      requestHash: await hashQuickEntrySubmissionPayload({
        submissionId: SUB_2,
        rows: [...resumeRows],
      }),
      rowCount: 2,
      now,
      db,
    });
    assert.equal(created.state, "created");
    if (created.state !== "created") return;

    await insertTerminalSubmissionRowForLease({
      actorUserId: ACTOR_A,
      submissionId: SUB_2,
      expectedProcessingStartedAt: created.submission.processingStartedAt,
      clientRowId: "p1",
      rowIndex: 0,
      status: QUICK_ENTRY_ROW_STATUS_INVALID,
      errorCode: "QUICK_ENTRY_CUSTOMER_NAME_INVALID",
      now,
      db,
    });

    // Stale reclaim path: force lease age then resume via batch service
    const staleNow = new Date(
      now.getTime() + (QUICK_ENTRY_SUBMISSION_LEASE_SECONDS + 5) * 1000,
    );
    const resumed = await processQuickEntryCustomerSubmission({
      actor: actorA,
      submissionId: SUB_2,
      rows: [
        {
          clientRowId: "p1",
          customerName: "恢复客户一",
          phone: "13930004001",
          requestedProjectName: "加拿大移民项目",
        },
        {
          clientRowId: "p2",
          customerName: "恢复客户二",
          phone: "13930004002",
          requestedProjectName: "加拿大移民项目",
        },
      ],
      now: staleNow,
      db,
    });
    assert.equal(resumed.ok, true);
    if (!resumed.ok) return;
    assert.equal(resumed.replayed, false);
    assert.equal(resumed.results[0]?.status, "invalid");
    assert.equal(resumed.results[1]?.status, "created");
    if (resumed.results[1]?.status === "created") {
      trackCreated([resumed.results[1].customerId]);
    }

    const rows = await listSubmissionRows({
      submissionDbId: created.submission.id,
      db,
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.status, "invalid");
    assert.equal(rows[1]?.status, "created");
  });

  it("heartbeat renews lease during long processing window", async function (this: TestContext) {
    if (!tablesReady) {
      this.skip();
      return;
    }
    await cleanup();
    await ensureActors();
    const start = new Date("2026-07-22T22:00:00.000Z");
    // Pre-create submission with old lease then renew via helper to prove CAS path
    const created = await createOrLoadSubmission({
      actorUserId: ACTOR_A,
      submissionId: "550e8400-e29b-41d4-a716-4466554400f1",
      requestHash: "e".repeat(64),
      rowCount: 1,
      now: start,
      db,
    });
    assert.equal(created.state, "created");
    if (created.state !== "created") return;
    const renewed = await renewQuickEntrySubmissionLease({
      actorUserId: ACTOR_A,
      submissionId: "550e8400-e29b-41d4-a716-4466554400f1",
      expectedProcessingStartedAt: created.submission.processingStartedAt,
      now: new Date(start.getTime() + 61_000),
      db,
    });
    assert.equal(renewed.state, "renewed");
    assert.notEqual(
      renewed.processingStartedAt,
      created.submission.processingStartedAt,
    );
    assert.equal(
      (await getSubmissionByActorAndClientId({
        actorUserId: ACTOR_A,
        submissionId: "550e8400-e29b-41d4-a716-4466554400f1",
        db,
      }))?.status,
      QUICK_ENTRY_SUBMISSION_STATUS_PROCESSING,
    );
  });
});
