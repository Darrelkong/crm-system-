import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { applyCollaboratorAssignees } from "@/lib/customers/assignees-mutations";
import { getStaffDeletePreview } from "@/lib/users-admin/delete-preview";
import { UserAdminError } from "@/lib/users-admin/service";

/** Isolated target staff for impact-count assertions (not SEED_IDS.staffB). */
const DELETE_PREVIEW_STAFF_ID = "d4444444-4444-4444-4444-444444444410";
const DELETE_PREVIEW_STAFF_EMAIL = "delete-preview-staff@crm.test.local";
const DELETE_PREVIEW_OWNED_1 = "d4444444-4444-4444-4444-444444444411";
const DELETE_PREVIEW_OWNED_2 = "d4444444-4444-4444-4444-444444444412";
const DELETE_PREVIEW_COLLAB_CUSTOMER = "d4444444-4444-4444-4444-444444444413";
const DELETE_PREVIEW_TASK = "d4444444-4444-4444-4444-444444444414";
const DELETE_PREVIEW_APPROVAL = "d4444444-4444-4444-4444-444444444415";
const DELETE_PREVIEW_COLLAB_PRIMARY = "d4444444-4444-4444-4444-444444444416";
const DELETE_PREVIEW_CUSTOMER_IDS = [
  DELETE_PREVIEW_OWNED_1,
  DELETE_PREVIEW_OWNED_2,
  DELETE_PREVIEW_COLLAB_CUSTOMER,
] as const;

let db: ReturnType<typeof drizzle<typeof schema>>;
let adminUser: User;
let disposeProxy: (() => Promise<void>) | undefined;

function makeCustomer(
  overrides: Partial<Customer> & Pick<Customer, "id" | "customerName">,
): Customer {
  const now = "2026-06-28T12:00:00.000Z";
  return {
    customerCode: null,
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000001",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    notes: null,
    salesStage: "new_lead",
    status: "active",
    ownerId: SEED_IDS.staffB,
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    isPinned: 0,
    pinnedAt: null,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    createdBy: SEED_IDS.staffB,
    updatedBy: SEED_IDS.staffB,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    ...overrides,
  } as Customer;
}

async function resetStaffUser(userId: string) {
  const now = new Date().toISOString();
  await db
    .update(schema.users)
    .set({ isActive: 1, deletedAt: null, updatedAt: now })
    .where(eq(schema.users.id, userId));
}

async function cleanupImpactCountFixtures() {
  await db
    .delete(schema.approvals)
    .where(eq(schema.approvals.id, DELETE_PREVIEW_APPROVAL));
  await db
    .delete(schema.tasks)
    .where(eq(schema.tasks.id, DELETE_PREVIEW_TASK));
  await db
    .delete(schema.customerAssignees)
    .where(
      inArray(schema.customerAssignees.customerId, [
        ...DELETE_PREVIEW_CUSTOMER_IDS,
      ]),
    );
  await db
    .delete(schema.customers)
    .where(inArray(schema.customers.id, [...DELETE_PREVIEW_CUSTOMER_IDS]));
  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, DELETE_PREVIEW_STAFF_ID));
  await db
    .delete(schema.users)
    .where(eq(schema.users.id, DELETE_PREVIEW_STAFF_ID));
}

async function ensureImpactCountStaff(): Promise<User> {
  const now = new Date().toISOString();
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, DELETE_PREVIEW_STAFF_ID))
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.users)
      .set({
        email: DELETE_PREVIEW_STAFF_EMAIL,
        displayName: "Delete Preview Staff",
        role: "staff",
        isActive: 1,
        deletedAt: null,
        updatedAt: now,
      })
      .where(eq(schema.users.id, DELETE_PREVIEW_STAFF_ID));
    return (await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, DELETE_PREVIEW_STAFF_ID))
      .limit(1))[0] as User;
  }

  await db.insert(schema.users).values({
    id: DELETE_PREVIEW_STAFF_ID,
    email: DELETE_PREVIEW_STAFF_EMAIL,
    displayName: "Delete Preview Staff",
    passwordHash: "INVALID_HASH_TEST_ONLY",
    role: "staff",
    isActive: 1,
    failedLoginAttempts: 0,
    lockedUntil: null,
    mustChangePassword: 0,
    createdAt: now,
    updatedAt: now,
  });

  return (await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, DELETE_PREVIEW_STAFF_ID))
    .limit(1))[0] as User;
}

async function expectUserAdminError(
  fn: () => Promise<unknown>,
  code: string,
) {
  await assert.rejects(fn, (error: unknown) => {
    return error instanceof UserAdminError && error.code === code;
  });
}

describe("getStaffDeletePreview", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: new URL("../../../wrangler.jsonc", import.meta.url).pathname,
    });
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);

    const adminRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.admin))
      .limit(1);
    adminUser = adminRows[0] as User;

    await resetStaffUser(SEED_IDS.staffB);
  });

  after(async () => {
    await resetStaffUser(SEED_IDS.staffB);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
    disposeProxy = undefined;
  });

  describe("impact counts with isolated staff", () => {
    before(async () => {
      await cleanupImpactCountFixtures();
      await ensureImpactCountStaff();

      const now = new Date().toISOString();
      await db.insert(schema.customers).values(
        makeCustomer({
          id: DELETE_PREVIEW_OWNED_1,
          customerName: "Preview Owned Customer 1",
          ownerId: DELETE_PREVIEW_STAFF_ID,
          createdBy: DELETE_PREVIEW_STAFF_ID,
          updatedBy: DELETE_PREVIEW_STAFF_ID,
        }),
      );
      await db.insert(schema.customers).values(
        makeCustomer({
          id: DELETE_PREVIEW_OWNED_2,
          customerName: "Preview Owned Customer 2",
          ownerId: DELETE_PREVIEW_STAFF_ID,
          createdBy: DELETE_PREVIEW_STAFF_ID,
          updatedBy: DELETE_PREVIEW_STAFF_ID,
        }),
      );
      await db.insert(schema.customers).values(
        makeCustomer({
          id: DELETE_PREVIEW_COLLAB_CUSTOMER,
          customerName: "Preview Collaborator Host",
          ownerId: SEED_IDS.staffA,
          createdBy: SEED_IDS.staffA,
          updatedBy: SEED_IDS.admin,
        }),
      );

      await db.insert(schema.customerAssignees).values({
        id: DELETE_PREVIEW_COLLAB_PRIMARY,
        customerId: DELETE_PREVIEW_COLLAB_CUSTOMER,
        userId: SEED_IDS.staffA,
        role: "primary",
        assignedBy: SEED_IDS.admin,
        assignedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      await applyCollaboratorAssignees(db, {
        customerId: DELETE_PREVIEW_COLLAB_CUSTOMER,
        collaboratorUserIds: [DELETE_PREVIEW_STAFF_ID],
        assignedBy: SEED_IDS.admin,
      });

      await db.insert(schema.tasks).values({
        id: DELETE_PREVIEW_TASK,
        customerId: DELETE_PREVIEW_OWNED_1,
        assignedTo: DELETE_PREVIEW_STAFF_ID,
        createdBy: SEED_IDS.admin,
        title: "Preview open task",
        description: null,
        type: "follow_up",
        status: "open",
        dueAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(schema.approvals).values({
        id: DELETE_PREVIEW_APPROVAL,
        requestType: "update_customer_assignees",
        status: "pending",
        customerId: DELETE_PREVIEW_OWNED_1,
        requestedBy: DELETE_PREVIEW_STAFF_ID,
        targetUserId: null,
        relatedCustomerIds: null,
        payload: JSON.stringify({ action: "set_collaborators" }),
        reason: "需要调整共同负责员工安排",
        adminComment: null,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    });

    after(async () => {
      await cleanupImpactCountFixtures();
    });

    it("returns preview for admin actor with impact counts", async () => {
      const preview = await getStaffDeletePreview(
        adminUser,
        DELETE_PREVIEW_STAFF_ID,
      );

      assert.equal(preview.ok, true);
      assert.equal(preview.user.id, DELETE_PREVIEW_STAFF_ID);
      assert.equal(preview.transferTo.id, SEED_IDS.admin);
      assert.equal(preview.impact.ownedCustomersCount, 2);
      assert.equal(preview.impact.collaboratorCustomersCount, 1);
      assert.equal(preview.impact.openTasksCount, 1);
      assert.equal(preview.impact.pendingApprovalsCount, 1);
    });
  });

  it("does not modify database state", async () => {
    const beforeUser = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.staffB))
      .limit(1);
    const beforeCustomers = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(eq(schema.customers.ownerId, SEED_IDS.staffB));

    await getStaffDeletePreview(adminUser, SEED_IDS.staffB);

    const afterUser = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.staffB))
      .limit(1);
    const afterCustomers = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(eq(schema.customers.ownerId, SEED_IDS.staffB));

    assert.deepEqual(afterUser[0], beforeUser[0]);
    assert.equal(afterCustomers.length, beforeCustomers.length);
  });

  it("cannot preview self", async () => {
    await expectUserAdminError(
      () => getStaffDeletePreview(adminUser, SEED_IDS.admin),
      "self_delete",
    );
  });

  it("cannot preview admin target", async () => {
    const otherAdmin = {
      ...adminUser,
      id: "99999999-9999-9999-9999-999999999998",
    } as User;

    await expectUserAdminError(
      () => getStaffDeletePreview(otherAdmin, SEED_IDS.admin),
      "cannot_delete_admin",
    );
  });

  it("cannot preview already deleted user", async () => {
    const now = new Date().toISOString();
    await db
      .update(schema.users)
      .set({ isActive: 0, deletedAt: now, updatedAt: now })
      .where(eq(schema.users.id, SEED_IDS.staffB));

    await expectUserAdminError(
      () => getStaffDeletePreview(adminUser, SEED_IDS.staffB),
      "already_deleted",
    );

    await resetStaffUser(SEED_IDS.staffB);
  });
});

describe("getStaffDeletePreview archived ownership", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: new URL("../../../wrangler.jsonc", import.meta.url).pathname,
    });
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);

    const adminRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.admin))
      .limit(1);
    adminUser = adminRows[0] as User;
    await resetStaffUser(SEED_IDS.staffB);
  });

  after(async () => {
    await db
      .delete(schema.customers)
      .where(
        eq(schema.customers.id, "d4444444-4444-4444-4444-444444444499"),
      );
    await resetStaffUser(SEED_IDS.staffB);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
    disposeProxy = undefined;
  });

  it("excludes archived owned customers from ownedCustomersCount", async () => {
    const archivedId = "d4444444-4444-4444-4444-444444444499";
    await db.insert(schema.customers).values(
      makeCustomer({
        id: archivedId,
        customerName: "Archived Owned Customer",
        ownerId: SEED_IDS.staffB,
        status: "archived",
      }),
    );

    const preview = await getStaffDeletePreview(adminUser, SEED_IDS.staffB);
    const ownedIds = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(eq(schema.customers.ownerId, SEED_IDS.staffB));

    const nonArchivedOwned = ownedIds.filter((row) => row.id !== archivedId);
    assert.equal(preview.impact.ownedCustomersCount, nonArchivedOwned.length);
  });
});
