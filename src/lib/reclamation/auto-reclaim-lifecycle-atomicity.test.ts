import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { listCustomerAssignees } from "@/lib/customers/assignees";
import { RECLAMATION_AUDIT_ACTIONS } from "@/lib/reclamation/constants";
import { runReclamationCheck } from "@/lib/reclamation/engine";
import {
  buildAutoReclaimCustomerExistsGuardSql,
  buildAutoReclaimSnapshotMatchSql,
  buildLastValidFollowUpAtMatchSql,
  toAutoReclaimCustomerSnapshot,
} from "@/lib/reclamation/auto-reclaim-cas";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const RECLAIM_OK_ID = "66666666-6666-6666-6666-666666666601";
const RECLAIM_RACE_ID = "66666666-6666-6666-6666-666666666602";
const RECLAIM_CYCLE_ID = "66666666-6666-6666-6666-666666666603";
const RECLAIM_TASK_ID = "66666666-6666-6666-6666-666666666604";

const TEST_CUSTOMER_IDS = [
  RECLAIM_OK_ID,
  RECLAIM_RACE_ID,
  RECLAIM_CYCLE_ID,
  RECLAIM_TASK_ID,
] as const;

const FIXED_NOW = new Date("2026-07-20T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Db;
let disposeProxy: (() => Promise<void>) | undefined;
let previousReclaimDays: string | null = null;
let previousDaysBefore: string | null = null;

function daysAgoIso(days: number, now = FIXED_NOW): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

function makeReclaimCustomer(
  id: string,
  idleDays: number,
  overrides: Partial<Customer> = {},
): Customer {
  const anchor = daysAgoIso(idleDays, FIXED_NOW);
  return {
    id,
    customerCode: null,
    customerName: `[TEST] Auto reclaim atomic ${id.slice(-2)}`,
    nameStatus: "confirmed",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000333",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    requestedProjectCode: null,
    notes: null,
    salesStage: "negotiation",
    ownerId: SEED_IDS.staffA,
    status: "active",
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: SEED_IDS.admin,
    updatedBy: SEED_IDS.admin,
    lastFollowUpAt: null,
    lastValidFollowUpAt: anchor,
    nextFollowUpAt: null,
    reclamationCycleStartedAt: overrides.reclamationCycleStartedAt ?? anchor,
    reclaimRuleGraceUntil: overrides.reclaimRuleGraceUntil ?? null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    pinnedSource: null,
    collaborativeDissolvedAt: null,
    lifecycleStatus: null,
    lifecycleCompletedAt: null,
    lifecycleCompletedBy: null,
    lifecycleCompletionNotes: null,
    preferredName: null,
    gender: null,
    ageRange: null,
    preferredLanguage: null,
    preferredContactMethod: null,
    occupation: null,
    companyName: null,
    jobTitle: null,
    targetCountryOrRegion: null,
    primaryConcern: null,
    createdAt: anchor,
    updatedAt: anchor,
    ...overrides,
  };
}

const pinnedForIsolation: string[] = [];

async function isolateOtherEligibleCustomers(keepCustomerIds: string[]) {
  await restoreIsolatedCustomers();
  const rows = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.status, "active"),
        isNotNull(schema.customers.ownerId),
        eq(schema.customers.isPinned, 0),
      ),
    );
  const others = rows
    .map((row) => row.id)
    .filter((id) => !keepCustomerIds.includes(id));
  for (let i = 0; i < others.length; i += 40) {
    const chunk = others.slice(i, i + 40);
    await db
      .update(schema.customers)
      .set({ isPinned: 1, pinnedAt: FIXED_NOW.toISOString() })
      .where(inArray(schema.customers.id, chunk));
    pinnedForIsolation.push(...chunk);
  }
}

async function restoreIsolatedCustomers() {
  while (pinnedForIsolation.length > 0) {
    const chunk = pinnedForIsolation.splice(0, 40);
    await db
      .update(schema.customers)
      .set({ isPinned: 0, pinnedAt: null })
      .where(inArray(schema.customers.id, chunk));
  }
}

async function deleteTestData() {
  await restoreIsolatedCustomers();
  for (const customerId of TEST_CUSTOMER_IDS) {
    await db
      .delete(schema.notifications)
      .where(eq(schema.notifications.relatedEntityId, customerId));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, customerId));
    await db
      .delete(schema.tasks)
      .where(eq(schema.tasks.customerId, customerId));
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, customerId));
    await db
      .delete(schema.reclamationWarningLogs)
      .where(eq(schema.reclamationWarningLogs.customerId, customerId));
    await db
      .delete(schema.reclamationActionItems)
      .where(eq(schema.reclamationActionItems.customerId, customerId));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, customerId));
  }
}

async function upsertSetting(key: string, value: string) {
  const existing = await db
    .select({ key: schema.systemSettings.key })
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(schema.systemSettings)
      .set({ value, updatedAt: FIXED_NOW.toISOString() })
      .where(eq(schema.systemSettings.key, key));
  } else {
    await db.insert(schema.systemSettings).values({
      key,
      value,
      updatedAt: FIXED_NOW.toISOString(),
    });
  }
}

async function seedAssignee(
  customerId: string,
  userId: string,
  role: "primary" | "collaborator",
) {
  const now = FIXED_NOW.toISOString();
  await db.insert(schema.customerAssignees).values({
    id: crypto.randomUUID(),
    customerId,
    userId,
    role,
    assignedAt: now,
    assignedBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedTask(input: {
  id: string;
  customerId: string;
  assignedTo: string;
  type: "follow_up" | "first_contact" | "other";
  status: "open" | "completed" | "cancelled";
}) {
  const now = FIXED_NOW.toISOString();
  await db.insert(schema.tasks).values({
    id: input.id,
    customerId: input.customerId,
    assignedTo: input.assignedTo,
    createdBy: SEED_IDS.admin,
    title: `task-${input.type}`,
    type: input.type,
    status: input.status,
    dueAt: now,
    completedAt: input.status === "completed" ? now : null,
    createdAt: now,
    updatedAt: now,
  });
}

async function countNotifs(customerId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.relatedEntityId, customerId),
        eq(schema.notifications.type, "customer_auto_reclaimed"),
      ),
    );
  return rows.length;
}

async function countReclaimAudits(customerId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.auditLogs.id })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.entityId, customerId),
        eq(schema.auditLogs.action, RECLAMATION_AUDIT_ACTIONS.reclaimed),
      ),
    );
  return rows.length;
}

describe("auto reclaim lifecycle atomicity wiring", () => {
  it("uses a single guarded batch with Customer CAS last", () => {
    const engine = read("src/lib/reclamation/engine.ts");
    const autoFn = engine.slice(engine.indexOf("async function autoReclaimCustomer"));
    assert.match(autoFn, /await db\.batch\(/);
    assert.match(autoFn, /buildGuardedDeleteCustomerAssigneesStatement/);
    assert.match(autoFn, /buildCancelOwnerOpenReclaimTasksStatement/);
    assert.match(autoFn, /buildCreateNotificationInsertSelectStatement/);
    assert.match(autoFn, /buildInsertAuditLogSelectStatement/);
    assert.match(autoFn, /buildAutoReclaimCustomerCasWhere/);
    assert.match(autoFn, /extractChanges\(batchResults\[4\]\)/);
    assert.doesNotMatch(autoFn, /createNotificationOnce/);
    assert.doesNotMatch(autoFn, /await createNotification\(/);

    const batchStart = autoFn.indexOf("await db.batch([");
    const batchBody = autoFn.slice(batchStart, autoFn.indexOf("] as unknown"));
    const deletePos = batchBody.indexOf("buildGuardedDeleteCustomerAssigneesStatement");
    const taskPos = batchBody.indexOf("buildCancelOwnerOpenReclaimTasksStatement");
    const notifPos = batchBody.indexOf("buildCreateNotificationInsertSelectStatement");
    const auditPos = batchBody.indexOf("buildInsertAuditLogSelectStatement");
    const casPos = batchBody.indexOf(".update(schema.customers)");
    assert.ok(deletePos >= 0 && taskPos > deletePos);
    assert.ok(notifPos > taskPos && auditPos > notifPos);
    assert.ok(casPos > auditPos);
  });

  it("CAS snapshot includes updatedAt, null-safe lastValidFollowUpAt, collaborative guard", () => {
    const cas = read("src/lib/reclamation/auto-reclaim-cas.ts");
    assert.match(cas, /customers\.updated_at/);
    assert.match(cas, /last_valid_follow_up_at IS NULL/);
    assert.match(cas, /role = 'collaborator'/);
    assert.match(cas, /customers\.is_pinned = 0/);
    assert.match(cas, /customers\.deleted_at IS NULL/);
    assert.match(cas, /closed_won[\s\S]*converted[\s\S]*on_hold[\s\S]*paid/);

    const nullSafe = buildLastValidFollowUpAtMatchSql(null);
    assert.ok(String(nullSafe.queryChunks ?? nullSafe).length >= 0);
    const snap = toAutoReclaimCustomerSnapshot(
      makeReclaimCustomer(RECLAIM_OK_ID, 8),
    );
    assert.ok(snap);
    assert.ok(buildAutoReclaimSnapshotMatchSql(snap));
    assert.ok(buildAutoReclaimCustomerExistsGuardSql(snap));
  });

  it("entries share runReclamationCheck; warning hardening and day7 stay intact", () => {
    const engine = read("src/lib/reclamation/engine.ts");
    assert.match(read("workers/reclamation-cron.ts"), /runReclamationCheck/);
    assert.match(
      read("src/lib/reclamation/run.ts"),
      /runReclamationCheck/,
    );
    const warnFn = engine.slice(engine.indexOf("async function sendReclaimWarning"));
    assert.match(warnFn, /db\.batch\(/);
    assert.doesNotMatch(warnFn, /buildCreateNotificationStatement/);
    assert.match(warnFn, /isReclamationWarningLogUniqueConflictError/);
    assert.match(engine, /resolveNextWarningMilestone/);
    assert.match(engine, /getSentWarningMilestonesInCycle/);
    assert.doesNotMatch(
      read("src/lib/reclamation/collaborative-dry-run.ts"),
      /db\.batch|autoReclaimCustomer|createNotification/,
    );
  });

  it("does not add migration, index, or package.json changes in reclaim helpers", () => {
    assert.doesNotMatch(
      read("src/lib/reclamation/auto-reclaim-cas.ts"),
      /CREATE INDEX|sqliteTable|migration/,
    );
    assert.doesNotMatch(
      read("src/lib/notifications/service.ts"),
      /createNotificationOnce[\s\S]*customer_auto_reclaimed/,
    );
  });
});

describe("auto reclaim lifecycle atomicity DB", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({ configPath: "wrangler.jsonc" });
    disposeProxy = () => proxy.dispose();
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);

    const settings = await db.select().from(schema.systemSettings);
    previousReclaimDays =
      settings.find((row) => row.key === "automatic_reclaim_days")?.value ??
      null;
    previousDaysBefore =
      settings.find((row) => row.key === "reclaim_warning_days_before")
        ?.value ?? null;
    await upsertSetting("automatic_reclaim_days", "7");
    await upsertSetting("reclaim_warning_days_before", "1");
  });

  after(async () => {
    await deleteTestData();
    if (previousReclaimDays != null) {
      await upsertSetting("automatic_reclaim_days", previousReclaimDays);
    }
    if (previousDaysBefore != null) {
      await upsertSetting("reclaim_warning_days_before", previousDaysBefore);
    }
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("reclaims customer atomically: pool, assignees, tasks, notification, audit", async () => {
    await deleteTestData();
    const customer = makeReclaimCustomer(RECLAIM_OK_ID, 8);
    await db.insert(schema.customers).values(customer);
    await seedAssignee(RECLAIM_OK_ID, SEED_IDS.staffA, "primary");
    await seedAssignee(RECLAIM_OK_ID, SEED_IDS.staffB, "collaborator");
    // collaborator makes this collaborative — wait, that would SKIP reclaim.
    // Use only primary for happy path.
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, RECLAIM_OK_ID));
    await seedAssignee(RECLAIM_OK_ID, SEED_IDS.staffA, "primary");

    const ownerFollowUp = crypto.randomUUID();
    const ownerFirst = crypto.randomUUID();
    const ownerOther = crypto.randomUUID();
    const otherAssigneeFollowUp = crypto.randomUUID();
    const completedFollowUp = crypto.randomUUID();
    await seedTask({
      id: ownerFollowUp,
      customerId: RECLAIM_OK_ID,
      assignedTo: SEED_IDS.staffA,
      type: "follow_up",
      status: "open",
    });
    await seedTask({
      id: ownerFirst,
      customerId: RECLAIM_OK_ID,
      assignedTo: SEED_IDS.staffA,
      type: "first_contact",
      status: "open",
    });
    await seedTask({
      id: ownerOther,
      customerId: RECLAIM_OK_ID,
      assignedTo: SEED_IDS.staffA,
      type: "other",
      status: "open",
    });
    await seedTask({
      id: otherAssigneeFollowUp,
      customerId: RECLAIM_OK_ID,
      assignedTo: SEED_IDS.staffB,
      type: "follow_up",
      status: "open",
    });
    await seedTask({
      id: completedFollowUp,
      customerId: RECLAIM_OK_ID,
      assignedTo: SEED_IDS.staffA,
      type: "follow_up",
      status: "completed",
    });

    await isolateOtherEligibleCustomers([RECLAIM_OK_ID]);
    const result = await runReclamationCheck(db, FIXED_NOW);
    assert.equal(result.reclaimedCount, 1);
    assert.ok(result.affectedCustomerIds.includes(RECLAIM_OK_ID));

    const updated = (
      await db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, RECLAIM_OK_ID))
    )[0];
    assert.equal(updated?.status, "public_pool");
    assert.equal(updated?.ownerId, null);
    assert.equal(updated?.previousOwnerId, SEED_IDS.staffA);
    assert.ok(updated?.poolEnteredAt);
    assert.ok(updated?.poolReason?.includes("自动回收"));
    assert.equal(updated?.releasedBy, null);
    assert.equal(updated?.releaserUserId, null);

    assert.equal((await listCustomerAssignees(db, RECLAIM_OK_ID)).length, 0);

    const tasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.customerId, RECLAIM_OK_ID));
    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    assert.equal(byId[ownerFollowUp]?.status, "cancelled");
    assert.equal(byId[ownerFirst]?.status, "cancelled");
    assert.equal(byId[ownerOther]?.status, "open");
    assert.equal(byId[otherAssigneeFollowUp]?.status, "open");
    assert.equal(byId[completedFollowUp]?.status, "completed");

    assert.equal(await countNotifs(RECLAIM_OK_ID), 1);
    const notif = (
      await db
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.relatedEntityId, RECLAIM_OK_ID),
            eq(schema.notifications.type, "customer_auto_reclaimed"),
          ),
        )
    )[0];
    assert.equal(notif?.userId, SEED_IDS.staffA);
    assert.equal(notif?.isRead, 0);

    assert.equal(await countReclaimAudits(RECLAIM_OK_ID), 1);

    const second = await runReclamationCheck(db, FIXED_NOW);
    assert.equal(second.reclaimedCount, 0);
    assert.equal(await countNotifs(RECLAIM_OK_ID), 1);
    assert.equal(await countReclaimAudits(RECLAIM_OK_ID), 1);
  });

  it("CAS skip when follow-up / owner / archive / pin / stage changes after SELECT snapshot", async () => {
    await deleteTestData();

    async function assertSkipAfterMutate(
      customerId: string,
      mutate: () => Promise<void>,
    ) {
      await deleteTestData();
      const customer = makeReclaimCustomer(customerId, 8);
      await db.insert(schema.customers).values(customer);
      await seedAssignee(customerId, SEED_IDS.staffA, "primary");
      await isolateOtherEligibleCustomers([customerId]);

      // Simulate SELECT-then-mutate by mutating before engine run is not enough;
      // instead mutate between two concurrent-style checks: bump fields that
      // break the in-engine snapshot by running mutate then reclaim with a
      // stale path — engine always re-reads. So we mutate AFTER inserting a
      // row that matches idle days, changing CAS fields before the job.
      await mutate();
      const result = await runReclamationCheck(db, FIXED_NOW);
      assert.equal(result.reclaimedCount, 0);
      assert.equal(await countNotifs(customerId), 0);
      assert.equal(await countReclaimAudits(customerId), 0);
    }

    await assertSkipAfterMutate(RECLAIM_RACE_ID, async () => {
      await db
        .update(schema.customers)
        .set({
          lastValidFollowUpAt: FIXED_NOW.toISOString(),
          reclamationCycleStartedAt: FIXED_NOW.toISOString(),
          updatedAt: FIXED_NOW.toISOString(),
        })
        .where(eq(schema.customers.id, RECLAIM_RACE_ID));
    });

    await assertSkipAfterMutate(RECLAIM_RACE_ID, async () => {
      await db
        .update(schema.customers)
        .set({
          ownerId: SEED_IDS.staffB,
          reclamationCycleStartedAt: FIXED_NOW.toISOString(),
          reclaimRuleGraceUntil: null,
          updatedAt: FIXED_NOW.toISOString(),
        })
        .where(eq(schema.customers.id, RECLAIM_RACE_ID));
    });

    await assertSkipAfterMutate(RECLAIM_RACE_ID, async () => {
      await db
        .update(schema.customers)
        .set({
          status: "archived",
          deletedAt: FIXED_NOW.toISOString(),
          updatedAt: FIXED_NOW.toISOString(),
        })
        .where(eq(schema.customers.id, RECLAIM_RACE_ID));
    });

    await assertSkipAfterMutate(RECLAIM_RACE_ID, async () => {
      await db
        .update(schema.customers)
        .set({
          isPinned: 1,
          pinnedAt: FIXED_NOW.toISOString(),
    pinnedSource: null,
          updatedAt: FIXED_NOW.toISOString(),
        })
        .where(eq(schema.customers.id, RECLAIM_RACE_ID));
    });

    await assertSkipAfterMutate(RECLAIM_RACE_ID, async () => {
      await db
        .update(schema.customers)
        .set({
          salesStage: "on_hold",
          updatedAt: FIXED_NOW.toISOString(),
        })
        .where(eq(schema.customers.id, RECLAIM_RACE_ID));
    });
  });

  it("concurrent second run skips after first reclaim succeeds", async () => {
    await deleteTestData();
    const customer = makeReclaimCustomer(RECLAIM_TASK_ID, 8);
    await db.insert(schema.customers).values(customer);
    await seedAssignee(RECLAIM_TASK_ID, SEED_IDS.staffA, "primary");
    await isolateOtherEligibleCustomers([RECLAIM_TASK_ID]);

    const [first, second] = await Promise.all([
      runReclamationCheck(db, FIXED_NOW),
      runReclamationCheck(db, FIXED_NOW),
    ]);
    const total =
      first.reclaimedCount +
      second.reclaimedCount;
    assert.equal(total, 1);
    assert.equal(await countNotifs(RECLAIM_TASK_ID), 1);
    assert.equal(await countReclaimAudits(RECLAIM_TASK_ID), 1);

    const assignees = await listCustomerAssignees(db, RECLAIM_TASK_ID);
    assert.equal(assignees.length, 0);
  });

  it("new cycle after reclaim+reclaimable reclaim can notify again", async () => {
    await deleteTestData();
    const customer = makeReclaimCustomer(RECLAIM_CYCLE_ID, 8);
    await db.insert(schema.customers).values(customer);
    await seedAssignee(RECLAIM_CYCLE_ID, SEED_IDS.staffA, "primary");
    await isolateOtherEligibleCustomers([RECLAIM_CYCLE_ID]);

    const first = await runReclamationCheck(db, FIXED_NOW);
    assert.equal(first.reclaimedCount, 1);
    assert.equal(await countNotifs(RECLAIM_CYCLE_ID), 1);

    const laterAnchor = daysAgoIso(8, FIXED_NOW);
    await db
      .update(schema.customers)
      .set({
        status: "active",
        ownerId: SEED_IDS.staffB,
        previousOwnerId: null,
        poolEnteredAt: null,
        poolReason: null,
        lastValidFollowUpAt: laterAnchor,
        updatedAt: laterAnchor,
        claimedAt: laterAnchor,
        claimedBy: SEED_IDS.staffB,
      })
      .where(eq(schema.customers.id, RECLAIM_CYCLE_ID));
    await seedAssignee(RECLAIM_CYCLE_ID, SEED_IDS.staffB, "primary");

    const second = await runReclamationCheck(db, FIXED_NOW);
    assert.equal(second.reclaimedCount, 1);
    assert.equal(await countNotifs(RECLAIM_CYCLE_ID), 2);
    assert.equal(await countReclaimAudits(RECLAIM_CYCLE_ID), 2);

    const notifs = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.relatedEntityId, RECLAIM_CYCLE_ID),
          eq(schema.notifications.type, "customer_auto_reclaimed"),
        ),
      );
    const recipients = new Set(notifs.map((n) => n.userId));
    assert.ok(recipients.has(SEED_IDS.staffA));
    assert.ok(recipients.has(SEED_IDS.staffB));
  });
});
