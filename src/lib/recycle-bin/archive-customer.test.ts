import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  assertStaffCannotChangeCustomerStatus,
  PermissionError,
} from "@/lib/permissions/customers";
import {
  DEFAULT_ADMIN_ARCHIVE_REASON,
  archiveCustomerToRecycleBin,
} from "@/lib/recycle-bin/archive-customer";
import { listRecycleBinCustomers } from "@/lib/recycle-bin/queries";

const TEST_CUSTOMER_1 = "d4444444-4444-4444-4444-444444444401";
const TEST_CUSTOMER_2 = "d4444444-4444-4444-4444-444444444402";
const TEST_CUSTOMER_3 = "d4444444-4444-4444-4444-444444444403";
const TEST_FOLLOW_UP = "f4444444-4444-4444-4444-444444444401";
const TEST_ASSIGNEE = "ca444444444444444444444444444444401";

let db: ReturnType<typeof drizzle<typeof schema>>;
let adminUser: User;
let staffUser: User;
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

async function deleteTestData() {
  const customerIds = [TEST_CUSTOMER_1, TEST_CUSTOMER_2, TEST_CUSTOMER_3];
  for (const customerId of customerIds) {
    await db
      .delete(schema.followUps)
      .where(eq(schema.followUps.customerId, customerId));
    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, customerId));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, customerId));
  }
}

describe("archiveCustomerToRecycleBin", () => {
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

    const staffRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.staffA))
      .limit(1);
    staffUser = staffRows[0]!;
  });

  after(async () => {
    await deleteTestData();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("sets status archived and recycle metadata", async () => {
    const now = "2026-06-29T10:00:00.000Z";
    const customer = makeCustomer({
      id: TEST_CUSTOMER_1,
      customerName: "Archive Test A",
      customerCode: "EF-ARCH-001",
    });
    await upsertCustomer(customer);

    await archiveCustomerToRecycleBin(db, {
      customer,
      actor: adminUser,
      source: "admin_patch",
      now,
    });

    const updated = await getCustomer(TEST_CUSTOMER_1);
    assert.ok(updated);
    assert.equal(updated.status, "archived");
    assert.equal(updated.deletedAt, now);
    assert.equal(updated.deletedBy, SEED_IDS.admin);
    assert.equal(updated.deletedReason, DEFAULT_ADMIN_ARCHIVE_REASON);
    assert.equal(updated.ownerId, SEED_IDS.staffA);
    assert.equal(updated.createdBy, SEED_IDS.staffA);
  });

  it("lists archived customer in recycle bin sorted by deletedAt DESC", async () => {
    const firstDeletedAt = "2026-06-29T08:00:00.000Z";
    const secondDeletedAt = "2026-06-29T12:00:00.000Z";

    const customer1 = makeCustomer({
      id: TEST_CUSTOMER_1,
      customerName: "Sort Test Older",
      customerCode: "EF-SORT-OLD",
    });
    const customer2 = makeCustomer({
      id: TEST_CUSTOMER_2,
      customerName: "Sort Test Newer",
      customerCode: "EF-SORT-NEW",
    });
    await upsertCustomer(customer1);
    await upsertCustomer(customer2);

    await archiveCustomerToRecycleBin(db, {
      customer: customer1,
      actor: adminUser,
      source: "admin_patch",
      now: firstDeletedAt,
    });
    await archiveCustomerToRecycleBin(db, {
      customer: customer2,
      actor: adminUser,
      source: "admin_patch",
      now: secondDeletedAt,
    });

    const items = await listRecycleBinCustomers();
    const testItems = items.filter((item) =>
      [TEST_CUSTOMER_1, TEST_CUSTOMER_2].includes(item.id),
    );
    assert.equal(testItems.length, 2);
    assert.equal(testItems[0]?.id, TEST_CUSTOMER_2);
    assert.equal(testItems[1]?.id, TEST_CUSTOMER_1);
    assert.equal(testItems[0]?.customer_code, "EF-SORT-NEW");
  });

  it("does not delete follow-ups or assignees", async () => {
    const now = "2026-06-29T10:00:00.000Z";
    const customer = makeCustomer({
      id: TEST_CUSTOMER_1,
      customerName: "Preserve Relations",
    });
    await upsertCustomer(customer);

    await db.insert(schema.followUps).values({
      id: TEST_FOLLOW_UP,
      customerId: TEST_CUSTOMER_1,
      userId: SEED_IDS.staffA,
      followUpTime: now,
      channel: "phone",
      outcome: "connected",
      summary: "Test follow-up",
      content: "Test follow-up",
      isValidFollowUp: 1,
      createdAt: now,
    });

    await db.insert(schema.customerAssignees).values({
      id: TEST_ASSIGNEE,
      customerId: TEST_CUSTOMER_1,
      userId: SEED_IDS.staffA,
      role: "primary",
      assignedBy: SEED_IDS.admin,
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await archiveCustomerToRecycleBin(db, {
      customer,
      actor: adminUser,
      source: "admin_patch",
      now,
    });

    const followUps = await db
      .select()
      .from(schema.followUps)
      .where(eq(schema.followUps.customerId, TEST_CUSTOMER_1));
    const assignees = await db
      .select()
      .from(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, TEST_CUSTOMER_1));

    assert.equal(followUps.length, 1);
    assert.equal(assignees.length, 1);
  });

  it("skips overwriting deletedAt when already archived with metadata", async () => {
    const originalDeletedAt = "2026-06-20T08:00:00.000Z";
    const customer = makeCustomer({
      id: TEST_CUSTOMER_1,
      customerName: "Already Archived",
      status: "archived",
      deletedAt: originalDeletedAt,
      deletedBy: SEED_IDS.staffA,
      deletedReason: "Existing reason",
    });
    await upsertCustomer(customer);

    const result = await archiveCustomerToRecycleBin(db, {
      customer,
      actor: adminUser,
      source: "admin_patch",
      now: "2026-06-29T10:00:00.000Z",
      reason: "Should not replace",
    });

    assert.equal(result.skipped, true);
    assert.equal(result.deletedAt, originalDeletedAt);

    const updated = await getCustomer(TEST_CUSTOMER_1);
    assert.equal(updated?.deletedAt, originalDeletedAt);
    assert.equal(updated?.deletedBy, SEED_IDS.staffA);
    assert.equal(updated?.deletedReason, "Existing reason");
  });

  it("backfills recycle metadata for archived customer missing deletedAt", async () => {
    const customer = makeCustomer({
      id: TEST_CUSTOMER_1,
      customerName: "Archived Without deletedAt",
      status: "archived",
      deletedAt: null,
      deletedBy: null,
      deletedReason: null,
    });
    await upsertCustomer(customer);

    const now = "2026-06-29T10:00:00.000Z";
    await archiveCustomerToRecycleBin(db, {
      customer,
      actor: adminUser,
      source: "admin_patch",
      now,
      reason: "Backfill archive metadata",
    });

    const updated = await getCustomer(TEST_CUSTOMER_1);
    assert.equal(updated?.deletedAt, now);
    assert.equal(updated?.deletedBy, SEED_IDS.admin);
    assert.equal(updated?.deletedReason, "Backfill archive metadata");

    const items = await listRecycleBinCustomers();
    assert.ok(items.some((item) => item.id === TEST_CUSTOMER_1));
  });

  it("D-1b style reject archive still appears in recycle bin", async () => {
    const now = "2026-06-29T11:00:00.000Z";
    const customer = makeCustomer({
      id: TEST_CUSTOMER_3,
      customerName: "Pending On Hold Reject",
      status: "active",
    });
    await upsertCustomer(customer);

    await db
      .update(schema.customers)
      .set({
        status: "archived",
        deletedAt: now,
        deletedBy: adminUser.id,
        deletedReason: "create_on_hold_customer rejected",
        updatedBy: adminUser.id,
        updatedAt: now,
      })
      .where(eq(schema.customers.id, TEST_CUSTOMER_3));

    const items = await listRecycleBinCustomers();
    const match = items.find((item) => item.id === TEST_CUSTOMER_3);
    assert.ok(match);
    assert.equal(match.deleted_reason, "create_on_hold_customer rejected");
    assert.equal(match.deleted_by, SEED_IDS.admin);
  });

  it("staff cannot change customer status via PATCH guard", () => {
    const customer = makeCustomer({
      id: TEST_CUSTOMER_1,
      customerName: "Staff Guard",
    });

    assert.throws(
      () =>
        assertStaffCannotChangeCustomerStatus(staffUser, customer, {
          status: "archived",
        }),
      (error: unknown) => {
        assert.ok(error instanceof PermissionError);
        assert.equal(error.status, 403);
        return true;
      },
    );
  });

  it("staff guard allows non-status updates", () => {
    const customer = makeCustomer({
      id: TEST_CUSTOMER_1,
      customerName: "Staff Guard",
    });

    assert.doesNotThrow(() =>
      assertStaffCannotChangeCustomerStatus(staffUser, customer, {
        customerName: "Updated Name",
      }),
    );
  });
});
