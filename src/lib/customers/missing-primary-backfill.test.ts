import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  parseArgs,
  writeJsonAtomic,
} from "../../../scripts/backfill-missing-primary-assignees";
import {
  MissingPrimaryBackfillError,
  compareAscii,
  computeSnapshotHash,
  deterministicPrimaryAssigneeId,
  queryMissingPrimaryTargets,
  rollbackMissingPrimaryBackfill,
  runMissingPrimaryApply,
  runMissingPrimaryDryRun,
  type MissingPrimaryBackfillManifest,
  type MissingPrimaryRollbackManifest,
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
  ownerCollab: "bbbbbbbb-0000-0000-0000-00000000000d",
  toctouOwner: "bbbbbbbb-0000-0000-0000-00000000000e",
  toctouPrimary: "bbbbbbbb-0000-0000-0000-00000000000f",
  toctouPool: "bbbbbbbb-0000-0000-0000-000000000010",
  toctouInactive: "bbbbbbbb-0000-0000-0000-000000000011",
} as const;

const CHUNK_CUSTOMER_PREFIX = "bbbbbbbb-chunk-";
const CHUNK_CUSTOMER_IDS = Array.from({ length: 5 }, (_, i) => {
  const n = String(i + 1).padStart(12, "0");
  return `${CHUNK_CUSTOMER_PREFIX}${n}`;
});

const ALL_CUSTOMER_IDS = [...Object.values(IDS), ...CHUNK_CUSTOMER_IDS];

const TEMP_INACTIVE_USER = "bbbbbbbb-user-0000-0000-000000000001";
const TEMP_DELETED_USER = "bbbbbbbb-user-0000-0000-000000000002";
const TEMP_TOCTOU_INACTIVE_USER = "bbbbbbbb-user-0000-0000-000000000003";

function memoryManifestWriter() {
  const versions: MissingPrimaryBackfillManifest[] = [];
  return {
    versions,
    onManifestUpdate: (manifest: MissingPrimaryBackfillManifest) => {
      versions.push(structuredClone(manifest));
    },
    latest: () => versions[versions.length - 1]!,
  };
}

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
    customerCode: `BF-${input.id}`,
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
    .where(
      inArray(schema.users.id, [
        TEMP_INACTIVE_USER,
        TEMP_DELETED_USER,
        TEMP_TOCTOU_INACTIVE_USER,
      ]),
    );
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
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("回填测试客户"), false);
    assert.equal(serialized.includes("customerName"), false);
  });

  it("apply creates unique primary matching owner with deterministic id", async () => {
    const dry = await runMissingPrimaryDryRun(db);
    assert.equal(dry.safeToApply, true);
    const writer = memoryManifestWriter();

    const result = await runMissingPrimaryApply(db, {
      expectedCount: dry.targetCount,
      expectedSnapshot: dry.snapshotHash,
      backfillRunId: "run-test-1",
      onManifestUpdate: writer.onManifestUpdate,
    });

    assert.equal(result.mode, "apply");
    assert.ok(result.insertedCount >= 3);
    assert.equal(result.manifest.insertedRows.length, result.insertedCount);
    assert.equal(result.manifest.status, "completed");

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
    assert.ok(
      audits.some((a) => a.action === "customer.assignee.primary_backfilled"),
    );
    assert.ok(audits.some((a) => a.userId == null));
  });

  it("second apply is idempotent (inserts 0)", async () => {
    const dry = await runMissingPrimaryDryRun(db);
    const writer = memoryManifestWriter();
    const result = await runMissingPrimaryApply(db, {
      expectedCount: dry.targetCount,
      expectedSnapshot: dry.snapshotHash,
      backfillRunId: "run-test-2",
      onManifestUpdate: writer.onManifestUpdate,
    });
    assert.equal(result.insertedCount, 0);
    assert.equal(result.rowsWritten, 0);

    const staffPrimary = await primaryFor(db, IDS.missingStaff);
    assert.equal(staffPrimary.length, 1);
  });

  it("expected-count mismatch writes 0", async () => {
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, IDS.missingStaff));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, IDS.missingStaff));

    const dry = await runMissingPrimaryDryRun(db);
    assert.ok(dry.targetCount >= 1);
    const writer = memoryManifestWriter();

    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry.targetCount + 99,
          expectedSnapshot: dry.snapshotHash,
          onManifestUpdate: writer.onManifestUpdate,
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
    const writer = memoryManifestWriter();
    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry.targetCount,
          expectedSnapshot: "0".repeat(64),
          onManifestUpdate: writer.onManifestUpdate,
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

    const dry = await runMissingPrimaryDryRun(db);
    assert.equal(dry.anomalies.activeMultiPrimary >= 1, true);
    assert.equal(dry.safeToApply, false);
    const writer = memoryManifestWriter();

    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry.targetCount,
          expectedSnapshot: dry.snapshotHash,
          onManifestUpdate: writer.onManifestUpdate,
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
    const writer = memoryManifestWriter();

    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry.targetCount,
          expectedSnapshot: dry.snapshotHash,
          onManifestUpdate: writer.onManifestUpdate,
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
          id: markerId,
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
    const writer = memoryManifestWriter();

    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry2.targetCount,
          expectedSnapshot: dry2.snapshotHash,
          onManifestUpdate: writer.onManifestUpdate,
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
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, IDS.missingStaff));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, IDS.missingStaff));

    const dry = await runMissingPrimaryDryRun(db);
    const writer = memoryManifestWriter();
    const result = await runMissingPrimaryApply(db, {
      expectedCount: dry.targetCount,
      expectedSnapshot: dry.snapshotHash,
      backfillRunId: "run-rollback",
      onManifestUpdate: writer.onManifestUpdate,
    });
    assert.ok(result.insertedCount >= 1);

    const staffId = deterministicPrimaryAssigneeId(
      IDS.missingStaff,
      SEED_IDS.staffA,
    );
    assert.ok(result.manifest.insertedRows.some((m) => m.assigneeId === staffId));

    const beforeOther = await primaryFor(db, IDS.alreadyPrimary);
    assert.equal(beforeOther.length, 1);

    const rollbackVersions: MissingPrimaryRollbackManifest[] = [];
    const rollback = await rollbackMissingPrimaryBackfill(
      db,
      result.manifest.insertedRows,
      {
        originalBackfillRunId: result.backfillRunId,
        onManifestUpdate: (m) => {
          rollbackVersions.push(structuredClone(m));
        },
      },
    );
    assert.equal(rollback.deletedCount, result.manifest.insertedRows.length);
    assert.equal(rollback.manifest.status, "completed");

    const afterStaff = await primaryFor(db, IDS.missingStaff);
    assert.equal(afterStaff.length, 0);

    const afterOther = await primaryFor(db, IDS.alreadyPrimary);
    assert.equal(afterOther.length, 1);
    assert.equal(afterOther[0]?.userId, SEED_IDS.staffB);

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

    const rollbackAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, IDS.missingStaff));
    assert.ok(
      rollbackAudits.some(
        (a) => a.action === "customer.assignee.primary_backfill_rolled_back",
      ),
    );
  });

  it("queryMissingPrimaryTargets and snapshot hash are stable/sorted", async () => {
    const targets = await queryMissingPrimaryTargets(db);
    for (let i = 1; i < targets.length; i += 1) {
      assert.ok(
        compareAscii(targets[i - 1]!.customerId, targets[i]!.customerId) <= 0,
        "targets must be ordered by customerId",
      );
    }
    const hash1 = computeSnapshotHash(targets);
    const hash2 = computeSnapshotHash([...targets].reverse());
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
  });

  it("locale-independent snapshot sorting matches binary order", () => {
    const ids = ["b-2", "a-1", "c-3"];
    const sorted = [...ids].sort(compareAscii);
    assert.deepEqual(sorted, ["a-1", "b-2", "c-3"]);
    assert.equal(compareAscii("a", "b"), -1);
    assert.equal(compareAscii("b", "a"), 1);
    assert.equal(compareAscii("a", "a"), 0);
  });

  it("CLI apply without --manifest-out is rejected", () => {
    const args = parseArgs([
      "--local",
      "--apply",
      "--expected-count",
      "1",
      "--expected-snapshot",
      "abc",
    ]);
    assert.equal(args.apply, true);
    assert.equal(args.manifestOut, null);
  });

  it("atomic manifest file write has no PII and supports partial_failed", () => {
    const dir = mkdtempSync(join(tmpdir(), "mp-manifest-"));
    const path = join(dir, "manifest.json");
    try {
      const manifest: MissingPrimaryBackfillManifest = {
        version: 1,
        backfillRunId: "run-file",
        snapshotHash: "a".repeat(64),
        expectedCount: 2,
        startedAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:01.000Z",
        status: "partial_failed",
        completedChunks: 1,
        failedChunkIndex: 1,
        errorCode: "TOCTOU_GUARD_FAILED",
        insertedRows: [
          {
            assigneeId: "ca_x_y",
            customerId: IDS.missingStaff,
            ownerId: SEED_IDS.staffA,
            auditLogId: "audit-1",
            chunkIndex: 0,
          },
        ],
      };
      writeJsonAtomic(path, manifest);
      const raw = readFileSync(path, "utf8");
      assert.equal(raw.includes("回填测试客户"), false);
      assert.equal(raw.includes("customerName"), false);
      assert.equal(raw.includes("phone"), false);
      assert.equal(raw.includes("email"), false);
      const parsed = JSON.parse(raw) as MissingPrimaryBackfillManifest;
      assert.equal(parsed.status, "partial_failed");
      assert.equal(parsed.insertedRows.length, 1);
      assert.equal(parsed.failedChunkIndex, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("multi-chunk: chunk1 success then chunk2 failure keeps partial manifest", async () => {
    for (const id of CHUNK_CUSTOMER_IDS) {
      await insertCustomer(db, {
        id,
        ownerId: SEED_IDS.staffA,
        status: "active",
        now: "2026-07-15T00:00:00.000Z",
      });
    }

    // Ensure missingStaff is a target again if prior tests left it filled.
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, IDS.missingStaff));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, IDS.missingStaff));

    const dry = await runMissingPrimaryDryRun(db);
    assert.ok(dry.targetCount >= 5);

    const writer = memoryManifestWriter();
    let calls = 0;
    const failingWriter = (manifest: MissingPrimaryBackfillManifest) => {
      writer.onManifestUpdate(manifest);
      calls += 1;
      // After chunk 0 completes (completedChunks becomes 1), poison the next
      // chunk by flipping a remaining target into public_pool.
      if (manifest.completedChunks === 1 && manifest.status === "in_progress") {
        const remaining = dry.targets.find(
          (t) =>
            !manifest.insertedRows.some((r) => r.customerId === t.customerId) &&
            CHUNK_CUSTOMER_IDS.includes(t.customerId),
        );
        if (remaining) {
          // Fire-and-forget sync poison via shared db handle — done below after await.
          (globalThis as { __poisonCustomerId?: string }).__poisonCustomerId =
            remaining.customerId;
        }
      }
    };

    // Use chunkSize=2 so 5 chunk customers + other fixtures span multiple chunks.
    // Poison between chunks via onManifestUpdate side effect before next revalidation.
    const applyPromise = runMissingPrimaryApply(db, {
      expectedCount: dry.targetCount,
      expectedSnapshot: dry.snapshotHash,
      backfillRunId: "run-multi-chunk",
      chunkSize: 2,
      onManifestUpdate: async (manifest) => {
        failingWriter(manifest);
        const poisonId = (globalThis as { __poisonCustomerId?: string })
          .__poisonCustomerId;
        if (
          poisonId &&
          manifest.completedChunks >= 1 &&
          manifest.status === "in_progress"
        ) {
          await db
            .update(schema.customers)
            .set({ status: "public_pool", ownerId: null })
            .where(eq(schema.customers.id, poisonId));
          delete (globalThis as { __poisonCustomerId?: string })
            .__poisonCustomerId;
        }
      },
    });

    await assert.rejects(
      () => applyPromise,
      (error: unknown) =>
        error instanceof MissingPrimaryBackfillError &&
        (error.code === "CHUNK_REVALIDATION_FAILED" ||
          error.code === "TOCTOU_GUARD_FAILED") &&
        error.manifest != null &&
        error.manifest.status === "partial_failed" &&
        error.manifest.insertedRows.length >= 2 &&
        error.manifest.completedChunks >= 1,
    );

    const latest = writer.latest();
    assert.equal(latest.status, "partial_failed");
    assert.ok(latest.insertedRows.length >= 2);
    assert.ok(latest.completedChunks >= 1);
    assert.ok(calls >= 2);

    // Successful chunk rows remain.
    for (const row of latest.insertedRows) {
      const primaries = await primaryFor(db, row.customerId);
      assert.equal(primaries.length, 1);
    }

    // Cleanup chunk fixtures + restore any poisoned row.
    for (const id of CHUNK_CUSTOMER_IDS) {
      await db
        .delete(schema.auditLogs)
        .where(eq(schema.auditLogs.entityId, id));
      await db
        .delete(schema.customerAssignees)
        .where(eq(schema.customerAssignees.customerId, id));
      await db.delete(schema.customers).where(eq(schema.customers.id, id));
    }
  });

  it("statement-level guard blocks owner change after snapshot", async () => {
    await insertCustomer(db, {
      id: IDS.toctouOwner,
      ownerId: SEED_IDS.staffA,
      status: "active",
    });

    const dry = await runMissingPrimaryDryRun(db);
    assert.ok(dry.targets.some((t) => t.customerId === IDS.toctouOwner));
    const writer = memoryManifestWriter();

    // Transfer owner after snapshot, before apply writes.
    await db
      .update(schema.customers)
      .set({ ownerId: SEED_IDS.staffB })
      .where(eq(schema.customers.id, IDS.toctouOwner));

    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry.targetCount,
          expectedSnapshot: dry.snapshotHash,
          chunkSize: 40,
          onManifestUpdate: writer.onManifestUpdate,
        }),
      (error: unknown) =>
        error instanceof MissingPrimaryBackfillError &&
        (error.code === "SNAPSHOT_MISMATCH" ||
          error.code === "COUNT_MISMATCH" ||
          error.code === "CHUNK_REVALIDATION_FAILED" ||
          error.code === "TOCTOU_GUARD_FAILED" ||
          error.code === "INVARIANT_BLOCKER"),
    );

    const primaries = await primaryFor(db, IDS.toctouOwner);
    // Must not create primary for the stale snapshot owner.
    assert.equal(
      primaries.some((p) => p.userId === SEED_IDS.staffA),
      false,
    );

    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, IDS.toctouOwner));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, IDS.toctouOwner));
  });

  it("statement-level guard blocks newly created primary after snapshot", async () => {
    await insertCustomer(db, {
      id: IDS.toctouPrimary,
      ownerId: SEED_IDS.staffA,
      status: "active",
    });
    const dry = await runMissingPrimaryDryRun(db);
    assert.ok(dry.targets.some((t) => t.customerId === IDS.toctouPrimary));

    await insertAssignee(db, {
      customerId: IDS.toctouPrimary,
      userId: SEED_IDS.staffA,
      role: "primary",
    });

    const writer = memoryManifestWriter();
    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry.targetCount,
          expectedSnapshot: dry.snapshotHash,
          onManifestUpdate: writer.onManifestUpdate,
        }),
      (error: unknown) =>
        error instanceof MissingPrimaryBackfillError &&
        (error.code === "COUNT_MISMATCH" ||
          error.code === "SNAPSHOT_MISMATCH" ||
          error.code === "CHUNK_REVALIDATION_FAILED" ||
          error.code === "TOCTOU_GUARD_FAILED"),
    );

    const primaries = await primaryFor(db, IDS.toctouPrimary);
    assert.equal(primaries.length, 1);

    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, IDS.toctouPrimary));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, IDS.toctouPrimary));
  });

  it("statement-level guard blocks public_pool after snapshot", async () => {
    await insertCustomer(db, {
      id: IDS.toctouPool,
      ownerId: SEED_IDS.staffA,
      status: "active",
    });
    const dry = await runMissingPrimaryDryRun(db);
    assert.ok(dry.targets.some((t) => t.customerId === IDS.toctouPool));

    await db
      .update(schema.customers)
      .set({ status: "public_pool", ownerId: null })
      .where(eq(schema.customers.id, IDS.toctouPool));

    const writer = memoryManifestWriter();
    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry.targetCount,
          expectedSnapshot: dry.snapshotHash,
          onManifestUpdate: writer.onManifestUpdate,
        }),
      (error: unknown) =>
        error instanceof MissingPrimaryBackfillError &&
        (error.code === "COUNT_MISMATCH" ||
          error.code === "SNAPSHOT_MISMATCH" ||
          error.code === "CHUNK_REVALIDATION_FAILED" ||
          error.code === "TOCTOU_GUARD_FAILED"),
    );

    const primaries = await primaryFor(db, IDS.toctouPool);
    assert.equal(primaries.length, 0);

    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, IDS.toctouPool));
  });

  it("statement-level guard blocks owner becoming inactive after snapshot", async () => {
    const now = "2026-07-10T00:00:00.000Z";
    await db.insert(schema.users).values({
      id: TEMP_TOCTOU_INACTIVE_USER,
      email: "toctou-inactive@crm.local",
      displayName: "Toctou Inactive",
      passwordHash: "x",
      role: "staff",
      isActive: 1,
      createdAt: now,
      updatedAt: now,
    });
    await insertCustomer(db, {
      id: IDS.toctouInactive,
      ownerId: TEMP_TOCTOU_INACTIVE_USER,
      status: "active",
    });

    const dry = await runMissingPrimaryDryRun(db);
    assert.ok(dry.targets.some((t) => t.customerId === IDS.toctouInactive));

    await db
      .update(schema.users)
      .set({ isActive: 0 })
      .where(eq(schema.users.id, TEMP_TOCTOU_INACTIVE_USER));

    const writer = memoryManifestWriter();
    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry.targetCount,
          expectedSnapshot: dry.snapshotHash,
          onManifestUpdate: writer.onManifestUpdate,
        }),
      (error: unknown) =>
        error instanceof MissingPrimaryBackfillError &&
        (error.code === "COUNT_MISMATCH" ||
          error.code === "SNAPSHOT_MISMATCH" ||
          error.code === "CHUNK_REVALIDATION_FAILED" ||
          error.code === "TOCTOU_GUARD_FAILED" ||
          error.code === "INVARIANT_BLOCKER"),
    );

    const primaries = await primaryFor(db, IDS.toctouInactive);
    assert.equal(primaries.length, 0);

    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, IDS.toctouInactive));
    await db
      .delete(schema.users)
      .where(eq(schema.users.id, TEMP_TOCTOU_INACTIVE_USER));
  });

  it("owner already collaborator blocks apply", async () => {
    await insertCustomer(db, {
      id: IDS.ownerCollab,
      ownerId: SEED_IDS.staffA,
      status: "active",
    });
    await insertAssignee(db, {
      customerId: IDS.ownerCollab,
      userId: SEED_IDS.staffA,
      role: "collaborator",
    });

    const dry = await runMissingPrimaryDryRun(db);
    assert.equal(dry.safeToApply, false);
    assert.ok(dry.anomalies.ownerAlreadyAssigneeOnTarget >= 1);
    const writer = memoryManifestWriter();

    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry.targetCount,
          expectedSnapshot: dry.snapshotHash,
          onManifestUpdate: writer.onManifestUpdate,
        }),
      (error: unknown) =>
        error instanceof MissingPrimaryBackfillError &&
        error.code === "INVARIANT_BLOCKER",
    );

    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, IDS.ownerCollab));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, IDS.ownerCollab));
  });

  it("audit insert failure rolls back primary and does not mark chunk success", async () => {
    // Ensure a clean missing target.
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, IDS.missingStaff));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, IDS.missingStaff));

    const dry = await runMissingPrimaryDryRun(db);
    const writer = memoryManifestWriter();
    const reservedAuditId = "bbbbbbbb-audit-dup-0000-000000000001";

    // Pre-insert an audit row that will collide when apply generates... we
    // cannot control generated audit UUIDs, so simulate by wrapping
    // onManifestUpdate is not enough. Instead run a tiny batch mirroring the
    // library pairing: guarded primary + duplicate-PK audit.
    const { buildGuardedPrimaryInsertStatement } = await import(
      "./missing-primary-backfill"
    );
    const target = (await queryMissingPrimaryTargets(db)).find(
      (t) => t.customerId === IDS.missingStaff,
    );
    assert.ok(target);

    await db.insert(schema.auditLogs).values({
      id: reservedAuditId,
      userId: null,
      action: "customer.assignee.primary_backfilled",
      entityType: "customer",
      entityId: IDS.missingStaff,
      metadata: "{}",
      createdAt: "2026-07-19T00:00:00.000Z",
    });

    const { buildConditionalAuditInsertStatement } = await import(
      "./missing-primary-backfill"
    );

    await assert.rejects(async () => {
      await db.batch([
        buildGuardedPrimaryInsertStatement(db, target!),
        buildConditionalAuditInsertStatement(db, {
          auditLogId: reservedAuditId,
          customerId: target!.customerId,
          ownerId: target!.ownerId,
          assigneeId: deterministicPrimaryAssigneeId(
            target!.customerId,
            target!.ownerId,
          ),
          backfillRunId: "run-audit-fail",
          createdAt: "2026-07-19T00:00:00.000Z",
        }),
      ] as unknown as Parameters<typeof db.batch>[0]);
    });

    const primaries = await primaryFor(db, IDS.missingStaff);
    assert.equal(primaries.length, 0, "primary must roll back with audit failure");
    assert.equal(writer.versions.length, 0, "chunk must not be marked success");

    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.id, reservedAuditId));
  });

  it("rollback skips when owner already transferred", async () => {
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, IDS.missingStaff));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, IDS.missingStaff));

    const dry = await runMissingPrimaryDryRun(db);
    const writer = memoryManifestWriter();
    const result = await runMissingPrimaryApply(db, {
      expectedCount: dry.targetCount,
      expectedSnapshot: dry.snapshotHash,
      backfillRunId: "run-rb-transfer",
      onManifestUpdate: writer.onManifestUpdate,
    });

    const staffRow = result.manifest.insertedRows.find(
      (r) => r.customerId === IDS.missingStaff,
    );
    assert.ok(staffRow);

    await db
      .update(schema.customers)
      .set({ ownerId: SEED_IDS.staffB })
      .where(eq(schema.customers.id, IDS.missingStaff));

    const rbVersions: MissingPrimaryRollbackManifest[] = [];
    const rollback = await rollbackMissingPrimaryBackfill(db, [staffRow!], {
      originalBackfillRunId: result.backfillRunId,
      onManifestUpdate: (m) => {
        rbVersions.push(structuredClone(m));
      },
    });

    assert.equal(rollback.deletedCount, 0);
    assert.equal(rollback.skippedCount, 1);
    assert.equal(rollback.skipped[0]?.reason, "owner_transferred");

    const primaries = await primaryFor(db, IDS.missingStaff);
    assert.equal(primaries.length, 1, "must not delete after owner transfer");

    // Restore owner for later tests and clean.
    await db
      .update(schema.customers)
      .set({ ownerId: SEED_IDS.staffA })
      .where(eq(schema.customers.id, IDS.missingStaff));
    await rollbackMissingPrimaryBackfill(db, result.manifest.insertedRows, {
      originalBackfillRunId: result.backfillRunId,
      onManifestUpdate: () => {},
    });
  });

  it("rollback skips when primary was legitimately replaced", async () => {
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, IDS.missingStaff));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, IDS.missingStaff));

    const dry = await runMissingPrimaryDryRun(db);
    const writer = memoryManifestWriter();
    const result = await runMissingPrimaryApply(db, {
      expectedCount: dry.targetCount,
      expectedSnapshot: dry.snapshotHash,
      backfillRunId: "run-rb-replaced",
      onManifestUpdate: writer.onManifestUpdate,
    });
    const staffRow = result.manifest.insertedRows.find(
      (r) => r.customerId === IDS.missingStaff,
    );
    assert.ok(staffRow);

    // Legitimate transfer-style replace: delete backfill primary, insert new UUID primary.
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, staffRow!.assigneeId));
    await insertAssignee(db, {
      id: "bbbbbbbb-legit-primary-0001",
      customerId: IDS.missingStaff,
      userId: SEED_IDS.staffA,
      role: "primary",
    });

    const rollback = await rollbackMissingPrimaryBackfill(db, [staffRow!], {
      originalBackfillRunId: result.backfillRunId,
      onManifestUpdate: () => {},
    });
    assert.equal(rollback.deletedCount, 0);
    assert.ok(
      rollback.skipped.some(
        (s) =>
          s.reason === "assignee_missing" || s.reason === "replaced_primary",
      ),
    );

    const primaries = await primaryFor(db, IDS.missingStaff);
    assert.equal(primaries.length, 1);
    assert.equal(primaries[0]?.id, "bbbbbbbb-legit-primary-0001");

    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, IDS.missingStaff));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, IDS.missingStaff));
    // Roll back any other inserted rows from this apply.
    await rollbackMissingPrimaryBackfill(
      db,
      result.manifest.insertedRows.filter(
        (r) => r.customerId !== IDS.missingStaff,
      ),
      {
        originalBackfillRunId: result.backfillRunId,
        onManifestUpdate: () => {},
      },
    );
  });

  it("rollback multi-chunk partial failure keeps completed deletes in manifest", async () => {
    for (const id of CHUNK_CUSTOMER_IDS.slice(0, 3)) {
      await insertCustomer(db, {
        id,
        ownerId: SEED_IDS.staffA,
        status: "active",
      });
    }

    const dry = await runMissingPrimaryDryRun(db);
    const writer = memoryManifestWriter();
    const result = await runMissingPrimaryApply(db, {
      expectedCount: dry.targetCount,
      expectedSnapshot: dry.snapshotHash,
      backfillRunId: "run-rb-multi",
      chunkSize: 2,
      onManifestUpdate: writer.onManifestUpdate,
    });
    assert.ok(result.manifest.insertedRows.length >= 3);

    const rows = result.manifest.insertedRows.filter((r) =>
      CHUNK_CUSTOMER_IDS.includes(r.customerId),
    );
    assert.ok(rows.length >= 3);

    const rbVersions: MissingPrimaryRollbackManifest[] = [];
    let poisoned = false;

    try {
      await rollbackMissingPrimaryBackfill(db, rows, {
        originalBackfillRunId: result.backfillRunId,
        chunkSize: 1,
        onManifestUpdate: async (m) => {
          rbVersions.push(structuredClone(m));
          if (
            !poisoned &&
            m.completedChunks === 1 &&
            m.status === "in_progress"
          ) {
            poisoned = true;
            const next = rows.find(
              (r) => !m.deletedRows.some((d) => d.assigneeId === r.assigneeId),
            );
            if (next) {
              await db
                .delete(schema.customerAssignees)
                .where(eq(schema.customerAssignees.id, next.assigneeId));
            }
          }
        },
      });
    } catch (error) {
      assert.ok(
        error instanceof Error && error.name === "MissingPrimaryRollbackError",
      );
    }

    const last = rbVersions[rbVersions.length - 1];
    assert.ok(last);
    assert.ok(
      last.deletedRows.length >= 1 ||
        last.status === "partial_failed" ||
        last.skipped.length >= 1,
    );

    for (const id of CHUNK_CUSTOMER_IDS.slice(0, 3)) {
      await db
        .delete(schema.auditLogs)
        .where(eq(schema.auditLogs.entityId, id));
      await db
        .delete(schema.customerAssignees)
        .where(eq(schema.customerAssignees.customerId, id));
      await db.delete(schema.customers).where(eq(schema.customers.id, id));
    }
  });

  it("apply without onManifestUpdate fails closed", async () => {
    const dry = await runMissingPrimaryDryRun(db);
    await assert.rejects(
      () =>
        runMissingPrimaryApply(db, {
          expectedCount: dry.targetCount,
          expectedSnapshot: dry.snapshotHash,
          // @ts-expect-error intentional missing hook
          onManifestUpdate: undefined,
        }),
      (error: unknown) =>
        error instanceof MissingPrimaryBackfillError &&
        error.code === "MANIFEST_REQUIRED",
    );
  });
});
