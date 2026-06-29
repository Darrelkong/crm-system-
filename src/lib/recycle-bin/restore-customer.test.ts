import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { listCustomersForUser } from "@/lib/customers/queries";
import { bindTestDatabase } from "@/lib/db";
import {
  assertCanManageCustomerAssignees,
  canManageCustomerAssignees,
} from "@/lib/permissions/customers";
import { archiveCustomerToRecycleBin } from "@/lib/recycle-bin/archive-customer";
import { listRecycleBinCustomers } from "@/lib/recycle-bin/queries";
import {
  RecycleBinError,
  restoreCustomerFromRecycleBin,
} from "@/lib/recycle-bin/service";

const TEST_ACTIVE = "d5555555-5555-5555-5555-555555555501";
const TEST_INACTIVE = "d5555555-5555-5555-5555-555555555502";
const TEST_PUBLIC_POOL = "d5555555-5555-5555-5555-555555555503";
const TEST_NO_LOG = "d5555555-5555-5555-5555-555555555504";
const TEST_D1B = "d5555555-5555-5555-5555-555555555505";
const TEST_RELATIONS = "d5555555-5555-5555-5555-555555555506";
const TEST_D2D = "d5555555-5555-5555-5555-555555555507";
const TEST_MISSING = "d5555555-5555-5555-5555-555555559999";

const TEST_FOLLOW_UP = "f5555555-5555-5555-5555-555555555501";
const TEST_ASSIGNEE_PRIMARY = "ca555555555555555555555555555555501";
const TEST_ASSIGNEE_COLLAB = "ca555555555555555555555555555555502";

const ALL_TEST_CUSTOMER_IDS = [
  TEST_ACTIVE,
  TEST_INACTIVE,
  TEST_PUBLIC_POOL,
  TEST_NO_LOG,
  TEST_D1B,
  TEST_RELATIONS,
  TEST_D2D,
];

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

async function getCustomer(id: string): Promise<Customer | undefined> {
  const rows = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, id))
    .limit(1);
  return rows[0];
}

async function archiveCustomer(
  customer: Customer,
  now = "2026-06-29T10:00:00.000Z",
) {
  const current = (await getCustomer(customer.id)) ?? customer;
  await archiveCustomerToRecycleBin(db, {
    customer: current,
    actor: adminUser,
    source: "admin_patch",
    now,
  });
}

async function assertInNormalList(customerId: string) {
  const items = await listCustomersForUser(adminUser, {}, 500);
  assert.ok(
    items.some((row) => row.id === customerId),
    `expected ${customerId} in normal customer list`,
  );
}

async function assertNotInNormalList(customerId: string) {
  const items = await listCustomersForUser(adminUser, {}, 500);
  assert.ok(
    !items.some((row) => row.id === customerId),
    `expected ${customerId} absent from normal customer list`,
  );
}

async function assertInRecycleBin(customerId: string) {
  const items = await listRecycleBinCustomers();
  assert.ok(
    items.some((row) => row.id === customerId),
    `expected ${customerId} in recycle bin`,
  );
}

async function assertNotInRecycleBin(customerId: string) {
  const items = await listRecycleBinCustomers();
  assert.ok(
    !items.some((row) => row.id === customerId),
    `expected ${customerId} absent from recycle bin`,
  );
}

async function getLatestRestoreAudit(customerId: string) {
  const rows = await db
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.entityType, "customer"),
        eq(schema.auditLogs.entityId, customerId),
        eq(schema.auditLogs.action, "customer.restored"),
      ),
    )
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(1);
  return rows[0];
}

async function getLatestRestoreFieldChange(
  customerId: string,
  expectedNewStatus: string,
) {
  const rows = await db
    .select()
    .from(schema.fieldChangeLogs)
    .where(
      and(
        eq(schema.fieldChangeLogs.customerId, customerId),
        eq(schema.fieldChangeLogs.fieldName, "status"),
        eq(schema.fieldChangeLogs.oldValue, "archived"),
        eq(schema.fieldChangeLogs.newValue, expectedNewStatus),
      ),
    )
    .orderBy(desc(schema.fieldChangeLogs.changedAt))
    .limit(1);
  return rows[0];
}

async function deleteTestData() {
  for (const customerId of ALL_TEST_CUSTOMER_IDS) {
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, customerId));
    await db
      .delete(schema.fieldChangeLogs)
      .where(eq(schema.fieldChangeLogs.customerId, customerId));
    await db
      .delete(schema.followUps)
      .where(eq(schema.followUps.customerId, customerId));
    await db
      .delete(schema.tasks)
      .where(eq(schema.tasks.customerId, customerId));
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, customerId));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, customerId));
  }
}

describe("restoreCustomerFromRecycleBin", () => {
  before(async () => {
    const proxy = await getPlatformProxy({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;

    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.admin))
      .limit(1);
    adminUser = users[0]!;
  });

  after(async () => {
    await deleteTestData();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("A. restores archived customer with cleared recycle metadata and list visibility", async () => {
    const now = "2026-06-29T10:00:00.000Z";
    const customer = makeCustomer({
      id: TEST_ACTIVE,
      customerName: "Restore Success",
      customerCode: "EF-REST-001",
      ownerId: SEED_IDS.staffA,
      createdBy: SEED_IDS.staffA,
    });
    await upsertCustomer(customer);
    await assertInNormalList(TEST_ACTIVE);

    await archiveCustomer(customer, now);
    await assertNotInNormalList(TEST_ACTIVE);
    await assertInRecycleBin(TEST_ACTIVE);

    const result = await restoreCustomerFromRecycleBin(adminUser, TEST_ACTIVE, {});
    assert.equal(result.id, TEST_ACTIVE);
    assert.equal(result.status, "active");

    const restored = await getCustomer(TEST_ACTIVE);
    assert.ok(restored);
    assert.equal(restored.status, "active");
    assert.equal(restored.deletedAt, null);
    assert.equal(restored.deletedBy, null);
    assert.equal(restored.deletedReason, null);
    assert.equal(restored.ownerId, SEED_IDS.staffA);
    assert.equal(restored.createdBy, SEED_IDS.staffA);

    await assertInNormalList(TEST_ACTIVE);
    await assertNotInRecycleBin(TEST_ACTIVE);
  });

  it("B. active → archived → restore returns active", async () => {
    const customer = makeCustomer({
      id: TEST_ACTIVE,
      customerName: "Restore Active",
      status: "active",
    });
    await upsertCustomer(customer);
    await archiveCustomer(customer);

    const result = await restoreCustomerFromRecycleBin(adminUser, TEST_ACTIVE, {});
    assert.equal(result.status, "active");
    assert.equal((await getCustomer(TEST_ACTIVE))?.status, "active");
  });

  it("B. inactive → archived → restore returns inactive", async () => {
    const customer = makeCustomer({
      id: TEST_INACTIVE,
      customerName: "Restore Inactive",
      status: "inactive",
    });
    await upsertCustomer(customer);
    await archiveCustomer(customer);

    const result = await restoreCustomerFromRecycleBin(
      adminUser,
      TEST_INACTIVE,
      {},
    );
    assert.equal(result.status, "inactive");
    assert.equal((await getCustomer(TEST_INACTIVE))?.status, "inactive");
  });

  it("B. missing field change log falls back to active", async () => {
    const now = "2026-06-29T10:00:00.000Z";
    const customer = makeCustomer({
      id: TEST_NO_LOG,
      customerName: "Restore No Field Log",
      status: "inactive",
    });
    await upsertCustomer(customer);

    await db
      .update(schema.customers)
      .set({
        status: "archived",
        deletedAt: now,
        deletedBy: adminUser.id,
        deletedReason: "Legacy archived without field log",
        updatedBy: adminUser.id,
        updatedAt: now,
      })
      .where(eq(schema.customers.id, TEST_NO_LOG));

    const result = await restoreCustomerFromRecycleBin(adminUser, TEST_NO_LOG, {});
    assert.equal(result.status, "active");
    assert.equal((await getCustomer(TEST_NO_LOG))?.status, "active");
  });

  it("B. public_pool → archived → restore returns active (current behavior)", async () => {
    const customer = makeCustomer({
      id: TEST_PUBLIC_POOL,
      customerName: "Restore Public Pool",
      status: "public_pool",
      ownerId: null,
      salesStage: "new_lead",
    });
    await upsertCustomer(customer);
    await archiveCustomer(customer);

    const result = await restoreCustomerFromRecycleBin(
      adminUser,
      TEST_PUBLIC_POOL,
      {},
    );
    assert.equal(
      result.status,
      "active",
      "public_pool prior status is not restorable; service falls back to active",
    );
    assert.equal((await getCustomer(TEST_PUBLIC_POOL))?.status, "active");
  });

  it("C. preserves customer_assignees and follow-ups after restore", async () => {
    const now = "2026-06-29T10:00:00.000Z";
    const customer = makeCustomer({
      id: TEST_RELATIONS,
      customerName: "Restore Relations",
    });
    await upsertCustomer(customer);

    await db.insert(schema.followUps).values({
      id: TEST_FOLLOW_UP,
      customerId: TEST_RELATIONS,
      userId: SEED_IDS.staffA,
      followUpTime: now,
      channel: "phone",
      outcome: "connected",
      summary: "Restore follow-up",
      content: "Restore follow-up",
      isValidFollowUp: 1,
      createdAt: now,
    });

    await db.insert(schema.customerAssignees).values([
      {
        id: TEST_ASSIGNEE_PRIMARY,
        customerId: TEST_RELATIONS,
        userId: SEED_IDS.staffA,
        role: "primary",
        assignedBy: SEED_IDS.admin,
        assignedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: TEST_ASSIGNEE_COLLAB,
        customerId: TEST_RELATIONS,
        userId: SEED_IDS.staffB,
        role: "collaborator",
        assignedBy: SEED_IDS.admin,
        assignedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await archiveCustomer(customer, now);
    await restoreCustomerFromRecycleBin(adminUser, TEST_RELATIONS, {});

    const followUps = await db
      .select()
      .from(schema.followUps)
      .where(eq(schema.followUps.customerId, TEST_RELATIONS));
    const assignees = await db
      .select()
      .from(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, TEST_RELATIONS));

    assert.equal(followUps.length, 1);
    assert.equal(assignees.length, 2);
    assert.ok(assignees.some((row) => row.role === "primary"));
    assert.ok(assignees.some((row) => row.role === "collaborator"));
  });

  it("D. writes field change log and audit log on restore", async () => {
    const customer = makeCustomer({
      id: TEST_ACTIVE,
      customerName: "Restore Audit Trail",
    });
    await upsertCustomer(customer);
    await archiveCustomer(customer);

    await restoreCustomerFromRecycleBin(adminUser, TEST_ACTIVE, {});

    const fieldChange = await getLatestRestoreFieldChange(TEST_ACTIVE, "active");
    assert.ok(fieldChange);
    assert.equal(fieldChange.changedBy, SEED_IDS.admin);

    const audit = await getLatestRestoreAudit(TEST_ACTIVE);
    assert.ok(audit);
    assert.equal(audit.userId, SEED_IDS.admin);
    assert.equal(audit.action, "customer.restored");

    const metadata = JSON.parse(audit.metadata ?? "{}") as {
      restoredStatus?: string;
      customerName?: string;
    };
    assert.equal(metadata.restoredStatus, "active");
    assert.equal(metadata.customerName, "Restore Audit Trail");
  });

  it("E. rejects restore for active customer with not_in_recycle_bin", async () => {
    const customer = makeCustomer({
      id: TEST_ACTIVE,
      customerName: "Active Not Restorable",
      status: "active",
    });
    await upsertCustomer(customer);

    await assert.rejects(
      () => restoreCustomerFromRecycleBin(adminUser, TEST_ACTIVE, {}),
      (error: unknown) => {
        assert.ok(error instanceof RecycleBinError);
        assert.equal(error.code, "not_in_recycle_bin");
        assert.equal(error.status, 400);
        return true;
      },
    );
  });

  it("E. rejects restore for archived customer missing deletedAt", async () => {
    const customer = makeCustomer({
      id: TEST_NO_LOG,
      customerName: "Archived Without deletedAt",
      status: "archived",
      deletedAt: null,
      deletedBy: null,
      deletedReason: null,
    });
    await upsertCustomer(customer);

    await assert.rejects(
      () => restoreCustomerFromRecycleBin(adminUser, TEST_NO_LOG, {}),
      (error: unknown) => {
        assert.ok(error instanceof RecycleBinError);
        assert.equal(error.code, "not_in_recycle_bin");
        return true;
      },
    );
  });

  it("E. rejects restore for missing customer with not_found", async () => {
    await assert.rejects(
      () => restoreCustomerFromRecycleBin(adminUser, TEST_MISSING, {}),
      (error: unknown) => {
        assert.ok(error instanceof RecycleBinError);
        assert.equal(error.code, "not_found");
        assert.equal(error.status, 404);
        return true;
      },
    );
  });

  it("F. D-1b rejected on_hold restore returns active with salesStage new_lead", async () => {
    const now = "2026-06-29T11:00:00.000Z";
    const customer = makeCustomer({
      id: TEST_D1B,
      customerName: "D-1b Rejected Restore",
      status: "active",
      salesStage: "new_lead",
    });
    await upsertCustomer(customer);
    await archiveCustomer(customer, now);

    const archived = await getCustomer(TEST_D1B);
    assert.ok(archived);
    assert.equal(archived.status, "archived");
    assert.equal(archived.salesStage, "new_lead");
    assert.ok(archived.deletedAt);

    const result = await restoreCustomerFromRecycleBin(adminUser, TEST_D1B, {});
    assert.equal(result.status, "active");

    const restored = await getCustomer(TEST_D1B);
    assert.ok(restored);
    assert.equal(restored.status, "active");
    assert.equal(restored.salesStage, "new_lead");
    assert.equal(restored.deletedAt, null);
  });

  it("G. D-2d blocks assignee management while archived and allows after restore", async () => {
    const customer = makeCustomer({
      id: TEST_D2D,
      customerName: "D-2d Restore Assignees",
    });
    await upsertCustomer(customer);
    await archiveCustomer(customer);

    const archived = (await getCustomer(TEST_D2D))!;
    assert.equal(canManageCustomerAssignees(adminUser, archived), false);
    assert.throws(() => assertCanManageCustomerAssignees(adminUser, archived));

    await restoreCustomerFromRecycleBin(adminUser, TEST_D2D, {});

    const restored = (await getCustomer(TEST_D2D))!;
    assert.equal(canManageCustomerAssignees(adminUser, restored), true);
    assert.doesNotThrow(() =>
      assertCanManageCustomerAssignees(adminUser, restored),
    );
  });
});
