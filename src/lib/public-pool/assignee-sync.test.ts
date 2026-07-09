import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase, getDb } from "@/lib/db";
import { listCustomerAssignees } from "@/lib/customers/assignees";
import { getCustomerById } from "@/lib/customers/queries";
import { listCustomersForUserPaginated } from "@/lib/customers/queries";
import {
  assertCanReleaseToPool,
  assertStaffCanViewCustomerDetailPage,
  PermissionError,
} from "@/lib/permissions/customers";
import {
  assertCanViewCustomerTimeline,
  getCustomerTimeline,
} from "@/lib/customers/timeline/service";
import { evaluateCustomerClaimEligibility } from "@/lib/public-pool/queries";
import { listPublicPoolCustomers } from "@/lib/public-pool/queries";
import {
  claimCustomerFromPool,
  releaseCustomerToPool,
} from "@/lib/public-pool/service";

const TEST_RELEASE_CUSTOMER_ID = "33333333-3333-3333-3333-333333333301";
const TEST_CLAIM_CUSTOMER_ID = "33333333-3333-3333-3333-333333333302";
const TEST_RACE_CUSTOMER_ID = "33333333-3333-3333-3333-333333333303";

const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

const FIXED_NOW = "2026-06-30T12:00:00.000Z";
const TEST_CUSTOMER_IDS = [
  TEST_RELEASE_CUSTOMER_ID,
  TEST_CLAIM_CUSTOMER_ID,
  TEST_RACE_CUSTOMER_ID,
] as const;

let db: ReturnType<typeof drizzle<typeof schema>>;
let dispose: (() => Promise<void>) | undefined;

function makeActiveCustomer(
  id: string,
  ownerId: string | null,
  overrides: Partial<Customer> = {},
): Customer {
  return {
    id,
    customerCode: null,
    customerName: `[TEST] Pool assignee sync ${id.slice(-2)}`,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000099",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: "測試項目",
    notes: null,
    salesStage: "new_lead",
    ownerId,
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
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  } as Customer;
}

function makePublicPoolCustomer(
  id: string,
  overrides: Partial<Customer> = {},
): Customer {
  return makeActiveCustomer(id, null, {
    status: "public_pool",
    ownerId: null,
    poolEnteredAt: FIXED_NOW,
    poolReason: "測試公共池",
    releasedBy: SEED_IDS.staffA,
    releaserUserId: SEED_IDS.staffA,
    previousOwnerId: SEED_IDS.staffA,
    ...overrides,
  });
}

async function deleteTestCustomers() {
  const ids = [...TEST_CUSTOMER_IDS];
  await db
    .delete(schema.aiInsightFeedback)
    .where(inArray(schema.aiInsightFeedback.customerId, ids));
  await db
    .delete(schema.customerAiInsights)
    .where(inArray(schema.customerAiInsights.customerId, ids));
  await db
    .delete(schema.approvals)
    .where(inArray(schema.approvals.customerId, ids));
  await db
    .delete(schema.tasks)
    .where(inArray(schema.tasks.customerId, ids));
  await db
    .delete(schema.followUps)
    .where(inArray(schema.followUps.customerId, ids));
  await db
    .delete(schema.fieldChangeLogs)
    .where(inArray(schema.fieldChangeLogs.customerId, ids));
  await db
    .delete(schema.reclamationWarningLogs)
    .where(inArray(schema.reclamationWarningLogs.customerId, ids));
  await db
    .delete(schema.customerContacts)
    .where(inArray(schema.customerContacts.customerId, ids));
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

async function insertTestCustomer(customer: Customer) {
  await db.insert(schema.customers).values(customer);
}

async function seedAssignees(
  customerId: string,
  entries: Array<{ userId: string; role: "primary" | "collaborator" }>,
) {
  const now = FIXED_NOW;
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

describe("public pool assignee sync (3B-IMPLEMENT)", () => {
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

  describe("release-to-pool", () => {
    it("staff release clears all customer_assignees and records clearedAssigneeCount", async () => {
      await deleteTestCustomers();
      const customer = makeActiveCustomer(
        TEST_RELEASE_CUSTOMER_ID,
        SEED_IDS.staffA,
      );
      await insertTestCustomer(customer);
      await seedAssignees(TEST_RELEASE_CUSTOMER_ID, [
        { userId: SEED_IDS.staffA, role: "primary" },
        { userId: SEED_IDS.staffB, role: "collaborator" },
      ]);

      await releaseCustomerToPool(customer, staffA, "測試釋放原因");

      const updated = await getCustomerById(TEST_RELEASE_CUSTOMER_ID);
      assert.ok(updated);
      assert.equal(updated.status, "public_pool");
      assert.equal(updated.ownerId, null);
      assert.equal(updated.previousOwnerId, SEED_IDS.staffA);
      assert.equal(updated.releasedBy, SEED_IDS.staffA);

      const assignees = await listCustomerAssignees(db, TEST_RELEASE_CUSTOMER_ID);
      assert.equal(assignees.length, 0);

      const metadata = await latestAuditMetadata(
        TEST_RELEASE_CUSTOMER_ID,
        "customer.released_to_pool",
      );
      assert.ok(metadata);
      assert.equal(metadata.clearedAssigneeCount, 2);
    });

    it("admin release clears all customer_assignees", async () => {
      await deleteTestCustomers();
      const customer = makeActiveCustomer(
        TEST_RELEASE_CUSTOMER_ID,
        SEED_IDS.staffB,
      );
      await insertTestCustomer(customer);
      await seedAssignees(TEST_RELEASE_CUSTOMER_ID, [
        { userId: SEED_IDS.staffB, role: "primary" },
        { userId: SEED_IDS.staffA, role: "collaborator" },
      ]);

      await releaseCustomerToPool(customer, admin, "管理員釋放");

      const assignees = await listCustomerAssignees(db, TEST_RELEASE_CUSTOMER_ID);
      assert.equal(assignees.length, 0);

      const metadata = await latestAuditMetadata(
        TEST_RELEASE_CUSTOMER_ID,
        "customer.released_to_pool",
      );
      assert.ok(metadata);
      assert.equal(metadata.clearedAssigneeCount, 2);
    });

    it("release permissions are unchanged", async () => {
      const owned = makeActiveCustomer(TEST_RELEASE_CUSTOMER_ID, SEED_IDS.staffA);
      assert.doesNotThrow(() => assertCanReleaseToPool(staffA, owned));
      assert.doesNotThrow(() => assertCanReleaseToPool(admin, owned));

      const otherOwned = makeActiveCustomer(
        TEST_RELEASE_CUSTOMER_ID,
        SEED_IDS.staffB,
      );
      assert.throws(
        () => assertCanReleaseToPool(staffA, otherOwned),
        (err: unknown) => err instanceof PermissionError,
      );

      const poolCustomer = makePublicPoolCustomer(TEST_RELEASE_CUSTOMER_ID);
      assert.throws(
        () => assertCanReleaseToPool(staffA, poolCustomer),
        (err: unknown) => err instanceof PermissionError,
      );
    });

    it("released customer appears in public pool list but not staff owned list", async () => {
      await deleteTestCustomers();
      const customer = makeActiveCustomer(
        TEST_RELEASE_CUSTOMER_ID,
        SEED_IDS.staffA,
      );
      await insertTestCustomer(customer);
      await seedAssignees(TEST_RELEASE_CUSTOMER_ID, [
        { userId: SEED_IDS.staffA, role: "primary" },
      ]);

      await releaseCustomerToPool(customer, staffA, "列表測試釋放");

      const poolRows = await listPublicPoolCustomers();
      assert.ok(
        poolRows.some((row) => row.id === TEST_RELEASE_CUSTOMER_ID),
      );

      const staffList = await listCustomersForUserPaginated(staffA, {}, 1);
      assert.equal(
        staffList.items.some((row) => row.id === TEST_RELEASE_CUSTOMER_ID),
        false,
      );
    });

    it("staff public_pool detail and timeline remain blocked after release", async () => {
      await deleteTestCustomers();
      const customer = makeActiveCustomer(
        TEST_RELEASE_CUSTOMER_ID,
        SEED_IDS.staffA,
      );
      await insertTestCustomer(customer);
      await releaseCustomerToPool(customer, staffA, "403 測試釋放");

      const released = await getCustomerById(TEST_RELEASE_CUSTOMER_ID);
      assert.ok(released);
      assert.equal(released.status, "public_pool");

      assert.throws(
        () => assertStaffCanViewCustomerDetailPage(staffA, released),
        (err: unknown) => {
          assert.ok(err instanceof PermissionError);
          assert.equal(err.auditAction, "PUBLIC_POOL_DETAIL_DENIED");
          return true;
        },
      );

      assert.throws(
        () => assertCanViewCustomerTimeline(staffA, released),
        (err: unknown) => {
          assert.ok(err instanceof PermissionError);
          assert.equal(err.auditAction, "PUBLIC_POOL_TIMELINE_DENIED");
          return true;
        },
      );

      await assert.rejects(
        () => getCustomerTimeline(getDb(), staffA, released),
        (err: unknown) => {
          assert.ok(err instanceof PermissionError);
          assert.equal(err.auditAction, "PUBLIC_POOL_TIMELINE_DENIED");
          return true;
        },
      );
    });
  });

  describe("claim-from-pool", () => {
    it("staff claim sets owner, active status, and single primary assignee", async () => {
      await deleteTestCustomers();
      const customer = makePublicPoolCustomer(TEST_CLAIM_CUSTOMER_ID, {
        releasedBy: null,
        releaserUserId: null,
      });
      await insertTestCustomer(customer);
      await seedAssignees(TEST_CLAIM_CUSTOMER_ID, [
        { userId: SEED_IDS.staffA, role: "primary" },
        { userId: SEED_IDS.staffB, role: "collaborator" },
      ]);

      const result = await claimCustomerFromPool(customer, staffB);
      assert.equal(result.ok, true);

      const updated = await getCustomerById(TEST_CLAIM_CUSTOMER_ID);
      assert.ok(updated);
      assert.equal(updated.status, "active");
      assert.equal(updated.ownerId, SEED_IDS.staffB);
      assert.equal(updated.claimedBy, SEED_IDS.staffB);
      assert.ok(updated.claimedAt);

      const assignees = await listCustomerAssignees(db, TEST_CLAIM_CUSTOMER_ID);
      assert.equal(assignees.length, 1);
      assert.equal(assignees[0]?.role, "primary");
      assert.equal(assignees[0]?.userId, SEED_IDS.staffB);
    });

    it("claim audit metadata includes primaryAssigneeSynced and clearedAssigneeCount", async () => {
      await deleteTestCustomers();
      const customer = makePublicPoolCustomer(TEST_CLAIM_CUSTOMER_ID, {
        releasedBy: null,
        releaserUserId: null,
      });
      await insertTestCustomer(customer);
      await seedAssignees(TEST_CLAIM_CUSTOMER_ID, [
        { userId: SEED_IDS.staffA, role: "primary" },
        { userId: SEED_IDS.staffB, role: "collaborator" },
      ]);

      const result = await claimCustomerFromPool(customer, staffB);
      assert.equal(result.ok, true);

      const metadata = await latestAuditMetadata(
        TEST_CLAIM_CUSTOMER_ID,
        "customer.claimed_from_pool",
      );
      assert.ok(metadata);
      assert.equal(metadata.primaryAssigneeSynced, true);
      assert.equal(metadata.clearedAssigneeCount, 2);
      assert.ok(typeof metadata.taskId === "string");
    });

    it("claim creates first contact task", async () => {
      await deleteTestCustomers();
      const customer = makePublicPoolCustomer(TEST_CLAIM_CUSTOMER_ID, {
        releasedBy: null,
        releaserUserId: null,
      });
      await insertTestCustomer(customer);

      const result = await claimCustomerFromPool(customer, staffB);
      assert.equal(result.ok, true);
      if (!result.ok) {
        return;
      }

      const tasks = await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.customerId, TEST_CLAIM_CUSTOMER_ID));
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0]?.type, "first_contact");
      assert.equal(tasks[0]?.assignedTo, SEED_IDS.staffB);
      assert.equal(tasks[0]?.id, result.taskId);
    });

    it("self-release eligibility block does not clear assignees", async () => {
      await deleteTestCustomers();
      const customer = makePublicPoolCustomer(TEST_CLAIM_CUSTOMER_ID, {
        releasedBy: SEED_IDS.staffA,
        releaserUserId: SEED_IDS.staffA,
        poolEnteredAt: new Date().toISOString(),
      });
      await insertTestCustomer(customer);
      await seedAssignees(TEST_CLAIM_CUSTOMER_ID, [
        { userId: SEED_IDS.staffA, role: "primary" },
        { userId: SEED_IDS.staffB, role: "collaborator" },
      ]);

      const before = await listCustomerAssignees(db, TEST_CLAIM_CUSTOMER_ID);
      const eligibility = evaluateCustomerClaimEligibility(
        staffA,
        customer,
        null,
      );
      assert.equal(eligibility.canClaim, false);
      assert.equal(eligibility.claimBlockedReasonKey, "selfReleased");

      const after = await listCustomerAssignees(db, TEST_CLAIM_CUSTOMER_ID);
      assert.deepEqual(after, before);
    });

    it("already claimed does not mutate assignees", async () => {
      await deleteTestCustomers();
      const customer = makePublicPoolCustomer(TEST_CLAIM_CUSTOMER_ID, {
        releasedBy: null,
        releaserUserId: null,
      });
      await insertTestCustomer(customer);
      await seedAssignees(TEST_CLAIM_CUSTOMER_ID, [
        { userId: SEED_IDS.staffA, role: "primary" },
      ]);

      const first = await claimCustomerFromPool(customer, staffB);
      assert.equal(first.ok, true);

      const assigneesAfterFirst = await listCustomerAssignees(
        db,
        TEST_CLAIM_CUSTOMER_ID,
      );
      assert.equal(assigneesAfterFirst.length, 1);
      assert.equal(assigneesAfterFirst[0]?.userId, SEED_IDS.staffB);

      const second = await claimCustomerFromPool(customer, staffA);
      assert.equal(second.ok, false);
      if (second.ok) {
        return;
      }
      assert.equal(second.reason, "already_claimed");

      const assigneesAfterSecond = await listCustomerAssignees(
        db,
        TEST_CLAIM_CUSTOMER_ID,
      );
      assert.deepEqual(assigneesAfterSecond, assigneesAfterFirst);
    });

    it("optimistic lock failure does not clear assignees", async () => {
      await deleteTestCustomers();
      const customer = makePublicPoolCustomer(TEST_RACE_CUSTOMER_ID, {
        releasedBy: null,
        releaserUserId: null,
      });
      await insertTestCustomer(customer);
      await seedAssignees(TEST_RACE_CUSTOMER_ID, [
        { userId: SEED_IDS.staffA, role: "primary" },
        { userId: SEED_IDS.staffB, role: "collaborator" },
      ]);

      await db
        .update(schema.customers)
        .set({
          ownerId: SEED_IDS.staffA,
          status: "active",
          claimedBy: SEED_IDS.staffA,
          claimedAt: FIXED_NOW,
          updatedAt: FIXED_NOW,
        })
        .where(eq(schema.customers.id, TEST_RACE_CUSTOMER_ID));

      const before = await listCustomerAssignees(db, TEST_RACE_CUSTOMER_ID);
      const result = await claimCustomerFromPool(customer, staffB);
      assert.equal(result.ok, false);
      if (result.ok) {
        return;
      }
      assert.equal(result.reason, "already_claimed");

      const after = await listCustomerAssignees(db, TEST_RACE_CUSTOMER_ID);
      assert.deepEqual(after, before);
    });
  });

  describe("post-claim visibility", () => {
    it("claimed customer appears in staff owned list with claimant primary only", async () => {
      await deleteTestCustomers();
      const customer = makePublicPoolCustomer(TEST_CLAIM_CUSTOMER_ID, {
        releasedBy: null,
        releaserUserId: null,
      });
      await insertTestCustomer(customer);
      await seedAssignees(TEST_CLAIM_CUSTOMER_ID, [
        { userId: SEED_IDS.staffA, role: "primary" },
        { userId: SEED_IDS.staffB, role: "collaborator" },
      ]);

      const claimResult = await claimCustomerFromPool(customer, staffB);
      assert.equal(claimResult.ok, true);

      const staffList = await listCustomersForUserPaginated(staffB, {}, 1);
      assert.ok(
        staffList.items.some((row) => row.id === TEST_CLAIM_CUSTOMER_ID),
      );

      const assignees = await listCustomerAssignees(db, TEST_CLAIM_CUSTOMER_ID);
      assert.equal(assignees.length, 1);
      assert.equal(assignees[0]?.role, "primary");
      assert.equal(assignees[0]?.userId, SEED_IDS.staffB);

      const claimed = await getCustomerById(TEST_CLAIM_CUSTOMER_ID);
      assert.ok(claimed);
      assert.doesNotThrow(() =>
        assertStaffCanViewCustomerDetailPage(staffB, claimed),
      );
    });
  });
});
