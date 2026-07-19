import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  MissingPrimaryBackfillError,
  computeSnapshotHash,
  deterministicPrimaryAssigneeId,
  queryMissingPrimaryTargets,
  rollbackMissingPrimaryBackfill,
  runMissingPrimaryApply,
  runMissingPrimaryDryRun,
} from "./missing-primary-backfill";

type Db = ReturnType<typeof drizzle<typeof schema>>;

const IDS = {
  missingStaff: "bbbbbbbb-0000-0000-0000-000000000001",
  missingAdmin: "bbbbbbbb-0000-0000-0000-000000000002",
  withCollab: "bbbbbbbb-0000-0000-0000-000000000003",
  alreadyPrimary: "bbbbbbbb-0000-0000-0000-000000000004",
  ownerNull: "bbbbbbbb-0000-0000-0000-000000000005",
  pool: "bbbbbbbb-0000-0000-0000-000000000006",
  archived: "bbbbbbbb-0000-0000-0000-000000000007",
  inactiveOwner: "bbbbbbbb-0000-0000-0000-000000000008",
  deletedOwner: "bbbbbbbb-0000-0000-0000-000000000009",
  multiPrimary: "bbbbbbbb-0000-0000-0000-00000000000a",
  primaryNeOwner: "bbbbbbbb-0000-0000-0000-00000000000b",
  atomicFail: "bbbbbbbb-0000-0000-0000-00000000000c",
} as const;

const ALL_CUSTOMER_IDS = Object.values(IDS);

const TEMP_INACTIVE_USER = "bbbbbbbb-user-0000-0000-000000000001";
const TEMP_DELETED_USER = "bbbbbbbb-user-0000-0000-000000000002";

async function insertCustomer(
  db: Db,
  input: {
    id: string;
    ownerId: string | null;
    status: "active" | "public_pool" | "archived";
    createdBy?: string;
    now?: string;
  },
) {
  const now = input.now ?? "2026-07-10T00:00:00.000Z";
  await db.insert(schema.customers).values({
    id: input.id,
    customerCode: `BF-${input.id.slice(-4)}`,
    customerName: "回填测试客户",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: null,
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    notes: null,
    salesStage: "new_lead",
    status: input.status,
    ownerId: input.ownerId,
    createdBy: input.createdBy ?? SEED_IDS.staffA,
    updatedBy: input.createdBy ?? SEED_IDS.staffA,
    createdAt: now,
    updatedAt: now,
  });
}

async function insertAssignee(
  db: Db,
  input: {
    id?: string;
    customerId: string;
    userId: string;
    role: "primary" | "collaborator";
    now?: string;
  },
) {
  const now = input.now ?? "2026-07-10T00:00:00.000Z";
  await db.insert(schema.customerAssignees).values({
    id:
      input.id ??
      (input.role === "primary"
        ? deterministicPrimaryAssigneeId(input.customerId, input.userId)
        : `ca_collab_${input.customerId}_${input.userId}`),
    customerId: input.customerId,
    userId: input.userId,
    role: input.role,
    assignedBy: SEED_IDS.admin,
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

async function cleanup(db: Db) {
  await db
    .delete(schema.auditLogs)
    .where(inArray(schema.auditLogs.entityId, ALL_CUSTOMER_IDS));
  await db
    .delete(schema.customerAssignees)
    .where(inArray(schema.customerAssignees.customerId, ALL_CUSTOMER_IDS));
  await db
    .delete(schema.customers)
    .where(inArray(schema.customers.id, ALL_CUSTOMER_IDS));
  await db
    .delete(schema.users)
    .where(inArray(schema.users.id, [TEMP_INACTIVE_USER, TEMP_DELETED_USER]));
}

async function primaryFor(db: Db, customerId: string) {
  return db
    .select()
    .from(schema.customerAssignees)
    .where(
      and(
        eq(schema.customerAssignees.customerId, customerId),
        eq(schema.customerAssignees.role, "primary"),
      ),
    );
}

async function seedBaseFixtures(db: Db) {
  await insertCustomer(db, {
    id: IDS.missingStaff,
    ownerId: SEED_IDS.staffA,
    status: "active",
    createdBy: SEED_IDS.staffA,
    now: "2026-07-14T06:00:00.000Z",
  });
  await insertCustomer(db, {
    id: IDS.missingAdmin,
    ownerId: SEED_IDS.admin,
    status: "active",
    createdBy: SEED_IDS.admin,
    now: "2026-07-14T07:00:00.000Z",
  });
  await insertCustomer(db, {
    id: IDS.withCollab,
    ownerId: SEED_IDS.staffA,
    status: "active",
    createdBy: SEED_IDS.staffA,
  });
  await insertAssignee(db, {
    customerId: IDS.withCollab,
    userId: SEED_IDS.staffB,
    role: "collaborator",
  });

  await insertCustomer(db, {
    id: IDS.alreadyPrimary,
    ownerId: SEED_IDS.staffB,
    status: "active",
  });
  await insertAssignee(db, {
    customerId: IDS.alreadyPrimary,
    userId: SEED_IDS.staffB,
    role: "primary",
  });

  await insertCustomer(db, {
    id: IDS.ownerNull,
    ownerId: null,
    status: "active",
  });

  await insertCustomer(db, {
    id: IDS.pool,
    ownerId: null,
    status: "public_pool",
  });

  await insertCustomer(db, {
    id: IDS.archived,
    ownerId: SEED_IDS.staffA,
    status: "archived",
  });

  const now = "2026-07-10T00:00:00.000Z";
  await db.insert(schema.users).values({
    id: TEMP_INACTIVE_USER,
    email: "inactive-backfill@crm.local",
    displayName: "Inactive BF",
    passwordHash: "x",
    role: "staff",
    isActive: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.users).values({
    id: TEMP_DELETED_USER,
    email: "deleted-backfill@crm.local",
    displayName: "Deleted BF",
    passwordHash: "x",
    role: "staff",
    isActive: 1,
    deletedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await insertCustomer(db, {
    id: IDS.inactiveOwner,
    ownerId: TEMP_INACTIVE_USER,
    status: "active",
  });
  await insertCustomer(db, {
    id: IDS.deletedOwner,
    ownerId: TEMP_DELETED_USER,
    status: "active",
  });
}

describe("missing-primary backfill", () => {
  let db: Db;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await cleanup(db);
    await seedBaseFixtures(db);
  });

  after(async () => {
    await cleanup(db);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("dry-run writes zero rows and includes valid missing-primary targets", async () => {
    const beforeAssignees = await db.select().from(schema.customerAssignees);
    const result = await runMissingPrimaryDryRun(db);
    const afterAssignees = await db.select().from(schema.customerAssignees);

    assert.equal(result.mode, "dry-run");
    assert.equal(result.rowsWritten, 0);
    assert.equal(beforeAssignees.length, afterAssignees.length);
    assert.ok(result.targetCount >= 2);
    assert.ok(
      result.targets.some((t) => t.customerId === IDS.missingStaff),
    );
    assert.ok(
      result.targets.some((t) => t.customerId === IDS.missingAdmin),
    );
    assert.ok(
      result.targets.some((t) => t.customerId === IDS.withCollab),
    );
    assert.equal(
      result.targets.some((t) => t.customerId === IDS.alreadyPrimary),
      false,
    );
    assert.equal(
      result.targets.some((t) => t.customerId === IDS.ownerNull),
      false,
    );
    assert.equal(
      result.targets.some((t) => t.customerId === IDS.pool),
      false,
    );
    assert.equal(
      result.targets.some((t) => t.customerId === IDS.archived),
      false,
    );
    assert.equal(
      result.targets.some((t) => t.customerId === IDS.inactiveOwner),
      false,
    );
    assert.equal(
      result.targets.some((t) => t.customerId === IDS.deletedOwner),
      false,
    );
    // No PII keys in dry-run payload.
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("回填测试客户"), false);
    assert.equal(serialized.includes("customerName"), false);
  });

  it("apply creates unique primary matching owner with deterministic id", async () => {
    const dry = await runMissingPrimaryDryRun(db);
    assert.equal(dry.safeToApply, true);

    const result = await runMissingPrimaryApply(db, {
      expectedCount: dry.targetCount,
      expectedSnapshot: dry.snapshotHash,
      backfillRunId: "run-test-1",
    });

    assert.equal(result.mode, "apply");
    assert.ok(result.insertedCount >= 3);
    assert.equal(result.manifest.length, result.insertedCount);

    const staffPrimary = await primaryFor(db, IDS.missingStaff);
    assert.equal(staffPrimary.length, 1);
    assert.equal(staffPrimary[0]?.userId, SEED_IDS.staffA);
    assert.equal(
      staffPrimary[0]?.id,
      deterministicPrimaryAssigneeId(IDS.missingStaff, SEED_IDS.staffA),
    );
    assert.equal(staffPrimary[0]?.assignedBy, SEED_IDS.staffA);
    assert.equal(staffPrimary[0]?.assignedAt, "2026-07-14T06:00:00.000Z");
    assert.equal(staffPrimary[0]?.createdAt, "2026-07-14T06:00:00.000Z");

    const adminPrimary = await primaryFor(db, IDS.missingAdmin);
    assert.equal(adminPrimary.length, 1);
    assert.equal(adminPrimary[0]?.userId, SEED_IDS.admin);

    const customer = await db
      .select({ ownerId: schema.customers.ownerId })
      .from(schema.customers)
      .where(eq(schema.customers.id, IDS.missingStaff))
      .limit(1);
    assert.equal(customer[0]?.ownerId, SEED_IDS.staffA);

    const collabs = await db
      .select()
      .from(schema.customerAssignees)
      .where(
        and(
          eq(schema.customerAssignees.customerId, IDS.withCollab),
          eq(schema.customerAssignees.role, "collaborator"),
        ),
      );
    assert.equal(collabs.length, 1);
    assert.equal(collabs[0]?.userId, SEED_IDS.staffB);

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, IDS.missingStaff));
    assert.ok(audits.some((a) => a.action === "customer.assignee.primary_backfilled"));
    assert.ok(audits.some((a) => a.userId == null));
  });

  it("second apply is idempotent (inserts 0)", async () => {
    const dry = await runMissingPrimaryDryRun(db);
    // After first apply, target set should be empty (or only unrelated leftovers).
    const result = await runMissingPrimaryApply(db, {
      expectedCount: dry.targetCount,
      expectedSnapshot: dry.snapshotHash,
      backfillRunId: "run-test-2",
    });
    assert.equal(result.insertedCount, 0);
    assert.equal(result.rowsWritten, 0);

    const staffPrimary = await primaryFor(db, IDS.missingStaff);
    assert.equal(staffPrimary.length, 1);
  });

  it("expected-count mismatch writes 0", async () => {
    // Re-seed one missing target after previous apply cleaned them.
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, IDS.missingStaff));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, IDS.missingStaff));

    const dry = await runMissingPrimaryDryRun(db);
    assert.ok(dry.targetCount >= 1);

    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry.targetCount + 99,
          expectedSnapshot: dry.snapshotHash,
        }),
      (error: unknown) =>
        error instanceof MissingPrimaryBackfillError &&
        error.code === "COUNT_MISMATCH",
    );

    const primaries = await primaryFor(db, IDS.missingStaff);
    assert.equal(primaries.length, 0);
  });

  it("expected-snapshot mismatch writes 0", async () => {
    const dry = await runMissingPrimaryDryRun(db);
    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry.targetCount,
          expectedSnapshot: "0".repeat(64),
        }),
      (error: unknown) =>
        error instanceof MissingPrimaryBackfillError &&
        error.code === "SNAPSHOT_MISMATCH",
    );
    const primaries = await primaryFor(db, IDS.missingStaff);
    assert.equal(primaries.length, 0);
  });

  it("multi-primary blocks apply", async () => {
    await insertCustomer(db, {
      id: IDS.multiPrimary,
      ownerId: SEED_IDS.staffA,
      status: "active",
    });
    // Two primary rows with different users — violates unique(customer,user)
    // so use staffA primary + force a second primary via unique different user
    // already as primary role (staffB).
    await insertAssignee(db, {
      id: `ca_multi_a_${IDS.multiPrimary}`,
      customerId: IDS.multiPrimary,
      userId: SEED_IDS.staffA,
      role: "primary",
    });
    await insertAssignee(db, {
      id: `ca_multi_b_${IDS.multiPrimary}`,
      customerId: IDS.multiPrimary,
      userId: SEED_IDS.staffB,
      role: "primary",
    });

    // Ensure at least one valid missing-primary candidate remains.
    const dry = await runMissingPrimaryDryRun(db);
    assert.equal(dry.anomalies.activeMultiPrimary >= 1, true);
    assert.equal(dry.safeToApply, false);

    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry.targetCount,
          expectedSnapshot: dry.snapshotHash,
        }),
      (error: unknown) =>
        error instanceof MissingPrimaryBackfillError &&
        error.code === "INVARIANT_BLOCKER",
    );

    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, IDS.multiPrimary));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, IDS.multiPrimary));
  });

  it("primary≠owner blocks apply", async () => {
    await insertCustomer(db, {
      id: IDS.primaryNeOwner,
      ownerId: SEED_IDS.staffA,
      status: "active",
    });
    await insertAssignee(db, {
      id: `ca_ne_${IDS.primaryNeOwner}`,
      customerId: IDS.primaryNeOwner,
      userId: SEED_IDS.staffB,
      role: "primary",
    });

    const dry = await runMissingPrimaryDryRun(db);
    assert.ok(dry.anomalies.activePrimaryNeOwner >= 1);
    assert.equal(dry.safeToApply, false);

    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry.targetCount,
          expectedSnapshot: dry.snapshotHash,
        }),
      (error: unknown) =>
        error instanceof MissingPrimaryBackfillError &&
        error.code === "INVARIANT_BLOCKER",
    );

    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, IDS.primaryNeOwner));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, IDS.primaryNeOwner));
  });

  it("db.batch rolls back owner-style assignee insert when a later statement fails", async () => {
    await insertCustomer(db, {
      id: IDS.atomicFail,
      ownerId: SEED_IDS.staffA,
      status: "active",
      now: "2026-07-11T00:00:00.000Z",
    });

    const assigneeId = deterministicPrimaryAssigneeId(
      IDS.atomicFail,
      SEED_IDS.staffA,
    );
    const markerId = "bbbbbbbb-marker-assignee-0001";
    await insertAssignee(db, {
      id: markerId,
      customerId: IDS.withCollab,
      userId: SEED_IDS.admin,
      role: "collaborator",
    });

    await assert.rejects(async () => {
      await db.batch([
        db.insert(schema.customerAssignees).values({
          id: assigneeId,
          customerId: IDS.atomicFail,
          userId: SEED_IDS.staffA,
          role: "primary",
          assignedBy: SEED_IDS.staffA,
          assignedAt: "2026-07-11T00:00:00.000Z",
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        }),
        db.insert(schema.customerAssignees).values({
          id: markerId, // duplicate PK → batch must fail
          customerId: IDS.atomicFail,
          userId: SEED_IDS.staffB,
          role: "collaborator",
          assignedBy: SEED_IDS.admin,
          assignedAt: "2026-07-11T00:00:00.000Z",
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        }),
      ] as unknown as Parameters<typeof db.batch>[0]);
    });

    const primaries = await primaryFor(db, IDS.atomicFail);
    assert.equal(primaries.length, 0, "failed batch must not leave primary");

    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, markerId));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, IDS.atomicFail));
  });

  it("deterministic id conflict blocks apply with 0 writes", async () => {
    await insertCustomer(db, {
      id: IDS.atomicFail,
      ownerId: SEED_IDS.staffA,
      status: "active",
      now: "2026-07-11T00:00:00.000Z",
    });

    const assigneeId = deterministicPrimaryAssigneeId(
      IDS.atomicFail,
      SEED_IDS.staffA,
    );
    await db.insert(schema.customerAssignees).values({
      id: assigneeId,
      customerId: IDS.alreadyPrimary,
      userId: SEED_IDS.admin,
      role: "collaborator",
      assignedBy: SEED_IDS.admin,
      assignedAt: "2026-07-11T00:00:00.000Z",
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    });

    const dry2 = await runMissingPrimaryDryRun(db);
    assert.equal(dry2.safeToApply, false);
    assert.ok(dry2.anomalies.deterministicIdConflict >= 1);

    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry2.targetCount,
          expectedSnapshot: dry2.snapshotHash,
        }),
      (error: unknown) =>
        error instanceof MissingPrimaryBackfillError &&
        error.code === "INVARIANT_BLOCKER",
    );

    const primaries = await primaryFor(db, IDS.atomicFail);
    assert.equal(primaries.length, 0);

    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, assigneeId));
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, IDS.atomicFail));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, IDS.atomicFail));
  });

  it("rollback manifest deletes only listed primary rows", async () => {
    // Ensure missingStaff is missing again then apply once for a clean manifest.
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, IDS.missingStaff));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, IDS.missingStaff));

    // Keep withCollab missing as well for a multi-entry manifest, if still missing.
    const dry = await runMissingPrimaryDryRun(db);
    const result = await runMissingPrimaryApply(db, {
      expectedCount: dry.targetCount,
      expectedSnapshot: dry.snapshotHash,
      backfillRunId: "run-rollback",
    });
    assert.ok(result.insertedCount >= 1);

    const staffId = deterministicPrimaryAssigneeId(
      IDS.missingStaff,
      SEED_IDS.staffA,
    );
    assert.ok(result.manifest.some((m) => m.assigneeId === staffId));

    // Pre-existing primary on alreadyPrimary must survive rollback of our manifest.
    const beforeOther = await primaryFor(db, IDS.alreadyPrimary);
    assert.equal(beforeOther.length, 1);

    const rollback = await rollbackMissingPrimaryBackfill(db, result.manifest);
    assert.equal(rollback.deletedCount, result.manifest.length);

    const afterStaff = await primaryFor(db, IDS.missingStaff);
    assert.equal(afterStaff.length, 0);

    const afterOther = await primaryFor(db, IDS.alreadyPrimary);
    assert.equal(afterOther.length, 1);
    assert.equal(afterOther[0]?.userId, SEED_IDS.staffB);

    // Collaborator on withCollab preserved if it was in/out of manifest.
    const collabs = await db
      .select()
      .from(schema.customerAssignees)
      .where(
        and(
          eq(schema.customerAssignees.customerId, IDS.withCollab),
          eq(schema.customerAssignees.role, "collaborator"),
        ),
      );
    assert.equal(collabs.length, 1);
  });

  it("queryMissingPrimaryTargets and snapshot hash are stable/sorted", async () => {
    const targets = await queryMissingPrimaryTargets(db);
    for (let i = 1; i < targets.length; i += 1) {
      assert.ok(
        targets[i - 1]!.customerId <= targets[i]!.customerId,
        "targets must be ordered by customerId",
      );
    }
    const hash1 = computeSnapshotHash(targets);
    const hash2 = computeSnapshotHash([...targets].reverse());
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
  });
});
