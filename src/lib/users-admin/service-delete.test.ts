import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { isCustomerAssignee } from "@/lib/customers/assignees";
import { listCustomerAssignees } from "@/lib/customers/assignees";
import { applyCollaboratorAssignees } from "@/lib/customers/assignees-mutations";
import {
  setUserStatus,
  softDeleteUserAccount,
  UserAdminError,
} from "@/lib/users-admin/service";

const CUSTOMER_1 = "d3333333-3333-3333-3333-333333333301";
const CUSTOMER_2 = "d3333333-3333-3333-3333-333333333302";
const CUSTOMER_3 = "d3333333-3333-3333-3333-333333333303";
const ARCHIVED_CUSTOMER = "d3333333-3333-3333-3333-333333333304";

/** Isolated fixtures for public-pool collaborator soft-delete (not seed pool / staffB). */
const SERVICE_DELETE_PUBLIC_POOL_STAFF_ID =
  "aa111111-aaaa-4111-8111-111111111101";
const SERVICE_DELETE_PUBLIC_POOL_STAFF_EMAIL =
  "svc-delete-pool-staff@crm.test.local";
const SERVICE_DELETE_PUBLIC_POOL_CUSTOMER_ID =
  "aa111111-aaaa-4111-8111-111111111102";
const SERVICE_DELETE_PUBLIC_POOL_CUSTOMER_CODE = "EFDELPP01";
const SERVICE_DELETE_PUBLIC_POOL_COLLAB_ID =
  "aa111111-aaaa-4111-8111-111111111103";

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
    ownerId: SEED_IDS.staffA,
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
    createdBy: SEED_IDS.staffA,
    updatedBy: SEED_IDS.staffA,
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

async function restoreSeedCustomers() {
  const now = new Date().toISOString();

  await db
    .update(schema.customers)
    .set({
      ownerId: SEED_IDS.staffA,
      updatedBy: SEED_IDS.staffA,
      updatedAt: now,
    })
    .where(eq(schema.customers.id, SEED_IDS.customerStaffA));

  await db
    .update(schema.customers)
    .set({
      ownerId: SEED_IDS.staffB,
      updatedBy: SEED_IDS.admin,
      updatedAt: now,
    })
    .where(eq(schema.customers.id, SEED_IDS.customerStaffB));

  await db
    .delete(schema.customerAssignees)
    .where(eq(schema.customerAssignees.customerId, SEED_IDS.customerStaffA));

  await db.insert(schema.customerAssignees).values({
    id: `ca_${SEED_IDS.customerStaffA}_${SEED_IDS.staffA}`,
    customerId: SEED_IDS.customerStaffA,
    userId: SEED_IDS.staffA,
    role: "primary",
    assignedBy: SEED_IDS.admin,
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await db
    .delete(schema.approvals)
    .where(eq(schema.approvals.customerId, SEED_IDS.customerStaffA));
}

async function deleteTestCustomers() {
  const ids = [CUSTOMER_1, CUSTOMER_2, CUSTOMER_3, ARCHIVED_CUSTOMER];
  for (const customerId of ids) {
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, customerId));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, customerId));
  }
}

async function upsertCustomer(customer: Customer) {
  const existing = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.id, customer.id))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.customers)
      .set(customer)
      .where(eq(schema.customers.id, customer.id));
  } else {
    await db.insert(schema.customers).values(customer);
  }
}

async function setPrimaryAssignee(customerId: string, userId: string) {
  await db
    .delete(schema.customerAssignees)
    .where(eq(schema.customerAssignees.customerId, customerId));
  const now = new Date().toISOString();
  await db.insert(schema.customerAssignees).values({
    id: `ca_${customerId}_${userId}`,
    customerId,
    userId,
    role: "primary",
    assignedBy: SEED_IDS.admin,
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

async function countActiveSessions(userId: string) {
  const rows = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)),
    );
  return rows.length;
}

async function expectUserAdminError(
  fn: () => Promise<unknown>,
  code: string,
) {
  await assert.rejects(fn, (error: unknown) => {
    return error instanceof UserAdminError && error.code === code;
  });
}

async function cleanupPublicPoolCollaboratorFixtures() {
  await db
    .delete(schema.customerAssignees)
    .where(
      eq(
        schema.customerAssignees.customerId,
        SERVICE_DELETE_PUBLIC_POOL_CUSTOMER_ID,
      ),
    );
  await db
    .delete(schema.tasks)
    .where(
      eq(schema.tasks.customerId, SERVICE_DELETE_PUBLIC_POOL_CUSTOMER_ID),
    );
  await db
    .delete(schema.fieldChangeLogs)
    .where(
      eq(
        schema.fieldChangeLogs.customerId,
        SERVICE_DELETE_PUBLIC_POOL_CUSTOMER_ID,
      ),
    );
  await db
    .delete(schema.auditLogs)
    .where(
      eq(schema.auditLogs.entityId, SERVICE_DELETE_PUBLIC_POOL_CUSTOMER_ID),
    );
  await db
    .delete(schema.customers)
    .where(eq(schema.customers.id, SERVICE_DELETE_PUBLIC_POOL_CUSTOMER_ID));
  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, SERVICE_DELETE_PUBLIC_POOL_STAFF_ID));
  await db
    .delete(schema.auditLogs)
    .where(eq(schema.auditLogs.entityId, SERVICE_DELETE_PUBLIC_POOL_STAFF_ID));
  await db
    .delete(schema.users)
    .where(eq(schema.users.id, SERVICE_DELETE_PUBLIC_POOL_STAFF_ID));
}

async function ensurePublicPoolCollaboratorStaff(): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, SERVICE_DELETE_PUBLIC_POOL_STAFF_ID))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.users)
      .set({
        email: SERVICE_DELETE_PUBLIC_POOL_STAFF_EMAIL,
        displayName: "Service Delete Pool Staff",
        role: "staff",
        isActive: 1,
        deletedAt: null,
        updatedAt: now,
      })
      .where(eq(schema.users.id, SERVICE_DELETE_PUBLIC_POOL_STAFF_ID));
    return;
  }

  await db.insert(schema.users).values({
    id: SERVICE_DELETE_PUBLIC_POOL_STAFF_ID,
    email: SERVICE_DELETE_PUBLIC_POOL_STAFF_EMAIL,
    displayName: "Service Delete Pool Staff",
    passwordHash: "INVALID_HASH_TEST_ONLY",
    role: "staff",
    isActive: 1,
    failedLoginAttempts: 0,
    lockedUntil: null,
    mustChangePassword: 0,
    createdAt: now,
    updatedAt: now,
  });
}

describe("softDeleteUserAccount assignee sync", () => {
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

    await resetStaffUser(SEED_IDS.staffA);
    await resetStaffUser(SEED_IDS.staffB);
    await deleteTestCustomers();
  });

  after(async () => {
    await resetStaffUser(SEED_IDS.staffA);
    await resetStaffUser(SEED_IDS.staffB);
    await cleanupPublicPoolCollaboratorFixtures();
    await deleteTestCustomers();
    await restoreSeedCustomers();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
    disposeProxy = undefined;
  });

  it("transfers owner, primary assignee, and removes collaborator rows on delete", async () => {
    const createdByC1 = SEED_IDS.staffA;
    const createdByC2 = SEED_IDS.staffB;
    const createdByC3 = SEED_IDS.staffA;

    await upsertCustomer(
      makeCustomer({
        id: CUSTOMER_1,
        customerName: "Delete Test Customer 1",
        ownerId: SEED_IDS.staffA,
        createdBy: createdByC1,
      }),
    );
    await upsertCustomer(
      makeCustomer({
        id: CUSTOMER_2,
        customerName: "Delete Test Customer 2",
        ownerId: SEED_IDS.staffB,
        createdBy: createdByC2,
      }),
    );
    await upsertCustomer(
      makeCustomer({
        id: CUSTOMER_3,
        customerName: "Delete Test Customer 3",
        ownerId: SEED_IDS.staffA,
        createdBy: createdByC3,
      }),
    );

    await setPrimaryAssignee(CUSTOMER_1, SEED_IDS.staffA);
    await setPrimaryAssignee(CUSTOMER_2, SEED_IDS.staffB);
    await setPrimaryAssignee(CUSTOMER_3, SEED_IDS.staffA);
    await applyCollaboratorAssignees(db, {
      customerId: CUSTOMER_2,
      collaboratorUserIds: [SEED_IDS.staffA],
      assignedBy: SEED_IDS.admin,
    });
    await applyCollaboratorAssignees(db, {
      customerId: CUSTOMER_3,
      collaboratorUserIds: [SEED_IDS.staffB],
      assignedBy: SEED_IDS.admin,
    });

    const sessionToken = `delete-test-session-${Date.now()}`;
    const now = new Date().toISOString();
    await db.insert(schema.sessions).values({
      id: crypto.randomUUID(),
      userId: SEED_IDS.staffA,
      tokenHash: sessionToken,
      createdAt: now,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      lastActivityAt: now,
      revokedAt: null,
    });
    assert.ok((await countActiveSessions(SEED_IDS.staffA)) > 0);

    const result = await softDeleteUserAccount(
      adminUser,
      SEED_IDS.staffA,
      {},
    );

    assert.ok(result.transferredCount >= 2);

    const staffAfter = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.staffA))
      .limit(1);
    assert.equal(staffAfter[0]?.isActive, 0);
    assert.ok(staffAfter[0]?.deletedAt);
    assert.equal(await countActiveSessions(SEED_IDS.staffA), 0);

    const customer1 = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, CUSTOMER_1))
      .limit(1);
    assert.equal(customer1[0]?.ownerId, SEED_IDS.admin);
    assert.equal(customer1[0]?.createdBy, createdByC1);

    const customer2 = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, CUSTOMER_2))
      .limit(1);
    assert.equal(customer2[0]?.ownerId, SEED_IDS.staffB);
    assert.equal(customer2[0]?.createdBy, createdByC2);

    const customer3 = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, CUSTOMER_3))
      .limit(1);
    assert.equal(customer3[0]?.ownerId, SEED_IDS.admin);
    assert.equal(customer3[0]?.createdBy, createdByC3);

    const assignees1 = await listCustomerAssignees(db, CUSTOMER_1);
    assert.ok(
      assignees1.some(
        (row) => row.role === "primary" && row.userId === SEED_IDS.admin,
      ),
    );
    assert.equal(
      assignees1.some((row) => row.userId === SEED_IDS.staffA),
      false,
    );

    const assignees2 = await listCustomerAssignees(db, CUSTOMER_2);
    assert.equal(
      assignees2.some((row) => row.userId === SEED_IDS.staffA),
      false,
    );
    assert.ok(
      assignees2.some(
        (row) => row.role === "primary" && row.userId === SEED_IDS.staffB,
      ),
    );

    const assignees3 = await listCustomerAssignees(db, CUSTOMER_3);
    assert.ok(
      assignees3.some(
        (row) => row.role === "primary" && row.userId === SEED_IDS.admin,
      ),
    );
    assert.ok(
      assignees3.some(
        (row) => row.role === "collaborator" && row.userId === SEED_IDS.staffB,
      ),
    );
    assert.equal(
      assignees3.filter((row) => row.role === "collaborator").length,
      1,
    );

    assert.equal(
      await isCustomerAssignee(db, CUSTOMER_2, SEED_IDS.staffA),
      false,
    );

    const duplicatePrimary = assignees1.filter((row) => row.role === "primary");
    assert.equal(duplicatePrimary.length, 1);
  });

  it("does not transfer archived customers or sync their primary assignee", async () => {
    await resetStaffUser(SEED_IDS.staffB);

    await upsertCustomer(
      makeCustomer({
        id: ARCHIVED_CUSTOMER,
        customerName: "Delete Test Archived",
        ownerId: SEED_IDS.staffB,
        status: "archived",
        createdBy: SEED_IDS.staffB,
      }),
    );
    await setPrimaryAssignee(ARCHIVED_CUSTOMER, SEED_IDS.staffB);

    await softDeleteUserAccount(adminUser, SEED_IDS.staffB, {});

    const archived = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, ARCHIVED_CUSTOMER))
      .limit(1);
    assert.equal(archived[0]?.ownerId, SEED_IDS.staffB);

    const assignees = await listCustomerAssignees(db, ARCHIVED_CUSTOMER);
    assert.ok(
      assignees.some(
        (row) => row.role === "primary" && row.userId === SEED_IDS.staffB,
      ),
    );
  });

  it("removes collaborator rows on public pool customers without owner transfer", async () => {
    await cleanupPublicPoolCollaboratorFixtures();
    await ensurePublicPoolCollaboratorStaff();

    const now = new Date().toISOString();
    const publicPoolId = SERVICE_DELETE_PUBLIC_POOL_CUSTOMER_ID;
    await db.insert(schema.customers).values(
      makeCustomer({
        id: publicPoolId,
        customerCode: SERVICE_DELETE_PUBLIC_POOL_CUSTOMER_CODE,
        customerName: "Service Delete Public Pool Customer",
        ownerId: null,
        status: "public_pool",
        poolEnteredAt: now,
        poolReason: "service-delete isolated fixture",
        releasedBy: null,
        releaserUserId: null,
        previousOwnerId: null,
        createdBy: SEED_IDS.admin,
        updatedBy: SEED_IDS.admin,
      }),
    );

    const existingAssignee = await db
      .select({ id: schema.customerAssignees.id })
      .from(schema.customerAssignees)
      .where(
        and(
          eq(schema.customerAssignees.customerId, publicPoolId),
          eq(
            schema.customerAssignees.userId,
            SERVICE_DELETE_PUBLIC_POOL_STAFF_ID,
          ),
        ),
      )
      .limit(1);
    assert.equal(
      existingAssignee.length,
      0,
      "isolated pool customer must have no assignee for target staff before setup",
    );

    await db.insert(schema.customerAssignees).values({
      id: SERVICE_DELETE_PUBLIC_POOL_COLLAB_ID,
      customerId: publicPoolId,
      userId: SERVICE_DELETE_PUBLIC_POOL_STAFF_ID,
      role: "collaborator",
      assignedBy: SEED_IDS.admin,
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const before = await db
      .select({
        ownerId: schema.customers.ownerId,
        status: schema.customers.status,
      })
      .from(schema.customers)
      .where(eq(schema.customers.id, publicPoolId))
      .limit(1);
    assert.equal(before[0]?.ownerId ?? null, null);
    assert.equal(before[0]?.status, "public_pool");
    assert.equal(
      await isCustomerAssignee(
        db,
        publicPoolId,
        SERVICE_DELETE_PUBLIC_POOL_STAFF_ID,
      ),
      true,
    );

    await softDeleteUserAccount(
      adminUser,
      SERVICE_DELETE_PUBLIC_POOL_STAFF_ID,
      {},
    );

    const after = await db
      .select({
        ownerId: schema.customers.ownerId,
        status: schema.customers.status,
      })
      .from(schema.customers)
      .where(eq(schema.customers.id, publicPoolId))
      .limit(1);
    assert.equal(after[0]?.ownerId ?? null, null);
    assert.equal(after[0]?.status, "public_pool");
    assert.equal(
      await isCustomerAssignee(
        db,
        publicPoolId,
        SERVICE_DELETE_PUBLIC_POOL_STAFF_ID,
      ),
      false,
    );

    const assignees = await listCustomerAssignees(db, publicPoolId);
    assert.equal(
      assignees.some((row) => row.role === "primary"),
      false,
    );
    assert.equal(assignees.length, 0);

    await cleanupPublicPoolCollaboratorFixtures();
  });

  it("avoids duplicate assignee rows when admin already exists on transferred customer", async () => {
    await resetStaffUser(SEED_IDS.staffB);

    const customerId = "d3333333-3333-3333-3333-333333333305";
    await upsertCustomer(
      makeCustomer({
        id: customerId,
        customerName: "Delete Test Admin Existing Row",
        ownerId: SEED_IDS.staffB,
        createdBy: SEED_IDS.staffB,
      }),
    );

    const now = new Date().toISOString();
    await db.insert(schema.customerAssignees).values([
      {
        id: `ca_${customerId}_${SEED_IDS.staffB}`,
        customerId,
        userId: SEED_IDS.staffB,
        role: "primary",
        assignedBy: SEED_IDS.admin,
        assignedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `ca_${customerId}_${SEED_IDS.admin}`,
        customerId,
        userId: SEED_IDS.admin,
        role: "collaborator",
        assignedBy: SEED_IDS.admin,
        assignedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await softDeleteUserAccount(adminUser, SEED_IDS.staffB, {});

    const assignees = await listCustomerAssignees(db, customerId);
    assert.equal(
      assignees.filter((row) => row.userId === SEED_IDS.admin).length,
      1,
    );
    assert.ok(
      assignees.some(
        (row) => row.role === "primary" && row.userId === SEED_IDS.admin,
      ),
    );
    assert.equal(
      assignees.some((row) => row.userId === SEED_IDS.staffB),
      false,
    );

    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, customerId));
    await db.delete(schema.customers).where(eq(schema.customers.id, customerId));
  });
});

describe("softDeleteUserAccount guards", () => {
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
    await restoreSeedCustomers();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
    disposeProxy = undefined;
  });

  it("cannot delete admin accounts", async () => {
    await expectUserAdminError(
      () => softDeleteUserAccount(adminUser, SEED_IDS.admin, {}),
      "self_delete",
    );

    const otherAdmin = {
      ...adminUser,
      id: "99999999-9999-9999-9999-999999999999",
    } as User;
    await expectUserAdminError(
      () => softDeleteUserAccount(otherAdmin, SEED_IDS.admin, {}),
      "cannot_delete_admin",
    );
  });

  it("cannot delete already deleted user", async () => {
    await softDeleteUserAccount(adminUser, SEED_IDS.staffB, {});
    await expectUserAdminError(
      () => softDeleteUserAccount(adminUser, SEED_IDS.staffB, {}),
      "already_deleted",
    );
  });

  it("cannot disable the last active admin", async () => {
    await expectUserAdminError(
      () =>
        setUserStatus(
          { ...adminUser, id: SEED_IDS.staffA, role: "staff" } as User,
          SEED_IDS.admin,
          "disabled",
          {},
        ),
      "last_admin",
    );
  });
});
