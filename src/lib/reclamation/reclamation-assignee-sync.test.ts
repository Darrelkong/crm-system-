import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase, getDb } from "@/lib/db";
import { listCustomerAssignees } from "@/lib/customers/assignees";
import { getCustomerById } from "@/lib/customers/queries";
import {
  assertCanViewCustomerTimeline,
  getCustomerTimeline,
} from "@/lib/customers/timeline/service";
import {
  assertStaffCanViewCustomerDetailPage,
  PermissionError,
} from "@/lib/permissions/customers";
import { evaluateCustomerClaimEligibility } from "@/lib/public-pool/queries";
import { RECLAMATION_AUDIT_ACTIONS } from "@/lib/reclamation/constants";
import { runReclamationCheck } from "@/lib/reclamation/engine";

const RECLAIM_TEST_ID = "44444444-4444-4444-4444-444444444411";
const COLLAB_SKIP_TEST_ID = "44444444-4444-4444-4444-444444444412";
const SELF_RELEASE_TEST_ID = "44444444-4444-4444-4444-444444444413";

const TEST_CUSTOMER_IDS = [
  RECLAIM_TEST_ID,
  COLLAB_SKIP_TEST_ID,
  SELF_RELEASE_TEST_ID,
] as const;

const FIXED_NOW = new Date("2026-06-30T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

let db: ReturnType<typeof drizzle<typeof schema>>;
let dispose: (() => Promise<void>) | undefined;

function daysAgoIso(days: number, now = FIXED_NOW): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

function makeReclaimableCustomer(
  id: string,
  overrides: Partial<Customer> = {},
): Customer {
  const anchor = daysAgoIso(8, FIXED_NOW);
  return {
    id,
    customerCode: null,
    customerName: `[TEST] Auto reclaim assignee sync ${id.slice(-2)}`,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000111",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
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
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    createdAt: anchor,
    updatedAt: anchor,
    ...overrides,
  } as Customer;
}

async function isolateOtherEligibleCustomers(keepCustomerIds: string[]) {
  const recent = daysAgoIso(1, FIXED_NOW);
  const rows = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.status, "active"),
        isNotNull(schema.customers.ownerId),
      ),
    );

  const idsToNeutralize = rows
    .map((row) => row.id)
    .filter((id) => !keepCustomerIds.includes(id));

  if (idsToNeutralize.length === 0) {
    return;
  }

  await db
    .update(schema.customers)
    .set({
      lastValidFollowUpAt: recent,
      updatedAt: FIXED_NOW.toISOString(),
    })
    .where(inArray(schema.customers.id, idsToNeutralize));
}

async function deleteTestCustomers() {
  const ids = [...TEST_CUSTOMER_IDS];
  await db
    .delete(schema.notifications)
    .where(inArray(schema.notifications.relatedEntityId, ids));
  await db
    .delete(schema.reclamationWarningLogs)
    .where(inArray(schema.reclamationWarningLogs.customerId, ids));
  await db
    .delete(schema.tasks)
    .where(inArray(schema.tasks.customerId, ids));
  await db
    .delete(schema.customerAssignees)
    .where(inArray(schema.customerAssignees.customerId, ids));
  await db
    .delete(schema.auditLogs)
    .where(inArray(schema.auditLogs.entityId, ids));
  await db
    .delete(schema.customers)
    .where(inArray(schema.customers.id, ids));
}

async function seedAssignees(
  customerId: string,
  entries: Array<{ userId: string; role: "primary" | "collaborator" }>,
) {
  const now = FIXED_NOW.toISOString();
  for (const entry of entries) {
    await db.insert(schema.customerAssignees).values({
      id: crypto.randomUUID(),
      customerId,
      userId: entry.userId,
      role: entry.role,
      assignedBy: SEED_IDS.admin,
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function latestAuditMetadata(
  entityId: string,
  action: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select({ metadata: schema.auditLogs.metadata })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.entityId, entityId),
        eq(schema.auditLogs.action, action),
      ),
    )
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(1);

  const raw = rows[0]?.metadata;
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("auto reclaim assignee sync (3B-2)", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await deleteTestCustomers();
  });

  after(async () => {
    await deleteTestCustomers();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("auto reclaim clears all assignees and preserves pool / audit / task / notification behavior", async () => {
    await deleteTestCustomers();
    const customer = makeReclaimableCustomer(RECLAIM_TEST_ID);
    await db.insert(schema.customers).values(customer);
    await seedAssignees(RECLAIM_TEST_ID, [
      { userId: SEED_IDS.staffA, role: "primary" },
    ]);

    const taskId = crypto.randomUUID();
    const followUpTaskId = crypto.randomUUID();
    const nowIso = FIXED_NOW.toISOString();
    await db.insert(schema.tasks).values({
      id: taskId,
      customerId: RECLAIM_TEST_ID,
      assignedTo: SEED_IDS.staffA,
      createdBy: SEED_IDS.admin,
      title: "首次联系客户：reclaim test",
      type: "first_contact",
      status: "open",
      dueAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await db.insert(schema.tasks).values({
      id: followUpTaskId,
      customerId: RECLAIM_TEST_ID,
      assignedTo: SEED_IDS.staffA,
      createdBy: SEED_IDS.admin,
      title: "跟进客户：reclaim test",
      type: "follow_up",
      status: "open",
      dueAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await isolateOtherEligibleCustomers([RECLAIM_TEST_ID]);
    const result = await runReclamationCheck(db, FIXED_NOW);
    assert.ok(result.affectedCustomerIds.includes(RECLAIM_TEST_ID));
    assert.ok(result.reclaimedCount >= 1);

    const updated = await getCustomerById(RECLAIM_TEST_ID);
    assert.ok(updated);
    assert.equal(updated.status, "public_pool");
    assert.equal(updated.ownerId, null);
    assert.equal(updated.previousOwnerId, SEED_IDS.staffA);
    assert.equal(updated.releasedBy, null);
    assert.equal(updated.releaserUserId, null);
    assert.ok(updated.poolEnteredAt);
    assert.ok(updated.poolReason?.includes("自动回收"));

    const assignees = await listCustomerAssignees(db, RECLAIM_TEST_ID);
    assert.equal(assignees.length, 0);

    const tasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId));
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.status, "cancelled");

    const notifications = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.relatedEntityId, RECLAIM_TEST_ID),
          eq(schema.notifications.type, "customer_auto_reclaimed"),
        ),
      );
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.userId, SEED_IDS.staffA);

    const metadata = await latestAuditMetadata(
      RECLAIM_TEST_ID,
      RECLAMATION_AUDIT_ACTIONS.reclaimed,
    );
    assert.ok(metadata);
    assert.equal(metadata.clearedAssigneeCount, 1);
    assert.equal(metadata.cancelledTaskCount, 2);
    assert.ok(typeof metadata.reclamationAnchorAt === "string");
    assert.equal(metadata.previousOwnerId, SEED_IDS.staffA);

    assert.throws(
      () => assertStaffCanViewCustomerDetailPage(staffA, updated),
      (err: unknown) => {
        assert.ok(err instanceof PermissionError);
        assert.equal(err.auditAction, "PUBLIC_POOL_DETAIL_DENIED");
        return true;
      },
    );

    assert.throws(
      () => assertCanViewCustomerTimeline(staffA, updated),
      (err: unknown) => {
        assert.ok(err instanceof PermissionError);
        assert.equal(err.auditAction, "PUBLIC_POOL_TIMELINE_DENIED");
        return true;
      },
    );

    await assert.rejects(
      () => getCustomerTimeline(getDb(), staffA, updated),
      (err: unknown) => {
        assert.ok(err instanceof PermissionError);
        assert.equal(err.auditAction, "PUBLIC_POOL_TIMELINE_DENIED");
        return true;
      },
    );
  });

  it("C-2 collaborative customers skip reclaim and keep assignees", async () => {
    await deleteTestCustomers();
    const customer = makeReclaimableCustomer(COLLAB_SKIP_TEST_ID);
    await db.insert(schema.customers).values(customer);
    await seedAssignees(COLLAB_SKIP_TEST_ID, [
      { userId: SEED_IDS.staffA, role: "primary" },
      { userId: SEED_IDS.staffB, role: "collaborator" },
    ]);

    const before = await listCustomerAssignees(db, COLLAB_SKIP_TEST_ID);
    assert.equal(before.length, 2);

    await isolateOtherEligibleCustomers([COLLAB_SKIP_TEST_ID]);
    const result = await runReclamationCheck(db, FIXED_NOW);
    assert.equal(
      result.affectedCustomerIds.includes(COLLAB_SKIP_TEST_ID),
      false,
    );

    const updated = await getCustomerById(COLLAB_SKIP_TEST_ID);
    assert.ok(updated);
    assert.equal(updated.status, "active");
    assert.equal(updated.ownerId, SEED_IDS.staffA);

    const after = await listCustomerAssignees(db, COLLAB_SKIP_TEST_ID);
    assert.deepEqual(after, before);
  });

  it("3A self-release block still applies and does not depend on auto reclaim assignee sync", async () => {
    await deleteTestCustomers();
    const customer = makeReclaimableCustomer(SELF_RELEASE_TEST_ID, {
      status: "public_pool",
      ownerId: null,
      poolEnteredAt: new Date().toISOString(),
      poolReason: "manual release test",
      releasedBy: SEED_IDS.staffA,
      releaserUserId: SEED_IDS.staffA,
      previousOwnerId: SEED_IDS.staffA,
    });
    await db.insert(schema.customers).values(customer);
    await seedAssignees(SELF_RELEASE_TEST_ID, [
      { userId: SEED_IDS.staffA, role: "primary" },
    ]);

    const before = await listCustomerAssignees(db, SELF_RELEASE_TEST_ID);
    const eligibility = evaluateCustomerClaimEligibility(
      staffA,
      customer,
      null,
    );
    assert.equal(eligibility.canClaim, false);
    assert.equal(eligibility.claimBlockedReasonKey, "selfReleased");

    const after = await listCustomerAssignees(db, SELF_RELEASE_TEST_ID);
    assert.deepEqual(after, before);
  });
});
