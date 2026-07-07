import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  CUSTOMER_LIFECYCLE_COMPLETED,
  completeCustomerLifecycle,
} from "@/lib/customers/lifecycle-complete";
import type { User } from "../../../drizzle/schema/users";
import {
  PENDING_SECOND_CONVERSION_NOTIFICATION_TYPE,
  notifyPendingSecondConversionIfEligible,
} from "./pending-second-conversion";

const TEST_CUSTOMER_ID = SEED_IDS.customerStaffB;
const TEST_COLLABORATOR_ROW_ID =
  "psc-test-collab-0001-0001-0001-000000000001";
const TEST_ADMIN_ASSIGNEE_ROW_ID =
  "psc-test-admin-0001-0001-0001-000000000001";

const admin = { id: SEED_IDS.admin, role: "admin" } as User;

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let baselineCustomer: Customer;
let baselineStaffA: Pick<
  typeof schema.users.$inferSelect,
  "isActive" | "deletedAt"
>;

const completedInputBase = {
  lifecycleStatus: CUSTOMER_LIFECYCLE_COMPLETED,
  status: "active" as const,
};

async function getCustomer(id: string): Promise<Customer | undefined> {
  const rows = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, id))
    .limit(1);
  return rows[0];
}

async function deletePendingSecondConversionNotifications(customerId: string) {
  await db
    .delete(schema.notifications)
    .where(
      and(
        eq(schema.notifications.relatedEntityType, "customer"),
        eq(schema.notifications.relatedEntityId, customerId),
        eq(
          schema.notifications.type,
          PENDING_SECOND_CONVERSION_NOTIFICATION_TYPE,
        ),
      ),
    );
}

async function clearAssignees(customerId: string) {
  await db
    .delete(schema.customerAssignees)
    .where(eq(schema.customerAssignees.customerId, customerId));
}

async function addCollaborator(
  customerId: string,
  userId: string,
  rowId: string,
) {
  const now = new Date().toISOString();
  await db.insert(schema.customerAssignees).values({
    id: rowId,
    customerId,
    userId,
    role: "collaborator",
    assignedBy: SEED_IDS.admin,
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

async function addPrimaryAssignee(customerId: string, userId: string) {
  const now = new Date().toISOString();
  await db.insert(schema.customerAssignees).values({
    id: `psc-primary-${customerId}`,
    customerId,
    userId,
    role: "primary",
    assignedBy: SEED_IDS.admin,
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

async function listNotificationUserIds(customerId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.notifications.userId })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.relatedEntityType, "customer"),
        eq(schema.notifications.relatedEntityId, customerId),
        eq(
          schema.notifications.type,
          PENDING_SECOND_CONVERSION_NOTIFICATION_TYPE,
        ),
      ),
    );

  return rows.map((row) => row.userId);
}

async function resetStaffA() {
  await db
    .update(schema.users)
    .set({
      isActive: baselineStaffA.isActive,
      deletedAt: baselineStaffA.deletedAt,
    })
    .where(eq(schema.users.id, SEED_IDS.staffA));
}

async function resetTestCustomer(overrides: Partial<Customer> = {}) {
  await db
    .update(schema.customers)
    .set({
      salesStage: "paid",
      status: "active",
      ownerId: SEED_IDS.staffB,
      deletedAt: null,
      deletedBy: null,
      deletedReason: null,
      lifecycleStatus: null,
      lifecycleCompletedAt: null,
      lifecycleCompletedBy: null,
      lifecycleCompletionNotes: null,
      updatedAt: baselineCustomer.updatedAt,
      updatedBy: baselineCustomer.updatedBy,
      ...overrides,
    })
    .where(eq(schema.customers.id, TEST_CUSTOMER_ID));

  await clearAssignees(TEST_CUSTOMER_ID);
  await deletePendingSecondConversionNotifications(TEST_CUSTOMER_ID);
  await resetStaffA();
}

before(async () => {
  process.env.CRM_ALLOW_TEST_DB_BIND = "1";
  const proxy = await getPlatformProxy<{ DB: unknown }>({
    configPath: "wrangler.jsonc",
  });
  disposeProxy = proxy.dispose;
  db = drizzle(proxy.env.DB, { schema });
  bindTestDatabase(db);

  const existing = await getCustomer(TEST_CUSTOMER_ID);
  assert.ok(existing, "seed customer must exist for pending second conversion tests");
  baselineCustomer = existing;

  const staffARows = await db
    .select({
      isActive: schema.users.isActive,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, SEED_IDS.staffA))
    .limit(1);
  baselineStaffA = staffARows[0]!;

  await resetTestCustomer();
});

after(async () => {
  await resetTestCustomer({
    salesStage: baselineCustomer.salesStage,
    status: baselineCustomer.status,
    ownerId: baselineCustomer.ownerId,
    lifecycleStatus: baselineCustomer.lifecycleStatus,
    lifecycleCompletedAt: baselineCustomer.lifecycleCompletedAt,
    lifecycleCompletedBy: baselineCustomer.lifecycleCompletedBy,
    lifecycleCompletionNotes: baselineCustomer.lifecycleCompletionNotes,
    deletedAt: baselineCustomer.deletedAt,
    deletedBy: baselineCustomer.deletedBy,
    deletedReason: baselineCustomer.deletedReason,
    updatedAt: baselineCustomer.updatedAt,
    updatedBy: baselineCustomer.updatedBy,
  });
  bindTestDatabase(null);
  delete process.env.CRM_ALLOW_TEST_DB_BIND;
  await disposeProxy?.();
});

describe("notifyPendingSecondConversionIfEligible (CUSTOMER-FLOW-3B-5 DB)", () => {
  it("notifies owner only when there are no extra assignees", async () => {
    await resetTestCustomer();
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationIds = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      ...completedInputBase,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    });

    assert.equal(notificationIds.length, 1);
    assert.deepEqual(await listNotificationUserIds(TEST_CUSTOMER_ID), [
      SEED_IDS.staffB,
    ]);
  });

  it("notifies owner and active staff assignee", async () => {
    await resetTestCustomer();
    await addCollaborator(
      TEST_CUSTOMER_ID,
      SEED_IDS.staffA,
      TEST_COLLABORATOR_ROW_ID,
    );
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationIds = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      ...completedInputBase,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    });

    assert.equal(notificationIds.length, 2);
    const recipients = await listNotificationUserIds(TEST_CUSTOMER_ID);
    assert.deepEqual(recipients.sort(), [SEED_IDS.staffA, SEED_IDS.staffB].sort());
  });

  it("notifies owner only once when owner matches assignee", async () => {
    await resetTestCustomer();
    await addPrimaryAssignee(TEST_CUSTOMER_ID, SEED_IDS.staffB);
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationIds = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      ...completedInputBase,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    });

    assert.equal(notificationIds.length, 1);
    assert.deepEqual(await listNotificationUserIds(TEST_CUSTOMER_ID), [
      SEED_IDS.staffB,
    ]);
  });

  it("does not notify inactive assignee", async () => {
    await resetTestCustomer();
    await addCollaborator(
      TEST_CUSTOMER_ID,
      SEED_IDS.staffA,
      TEST_COLLABORATOR_ROW_ID,
    );
    await db
      .update(schema.users)
      .set({ isActive: 0 })
      .where(eq(schema.users.id, SEED_IDS.staffA));

    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationIds = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      ...completedInputBase,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    });

    assert.equal(notificationIds.length, 1);
    assert.deepEqual(await listNotificationUserIds(TEST_CUSTOMER_ID), [
      SEED_IDS.staffB,
    ]);
  });

  it("does not notify deleted assignee", async () => {
    await resetTestCustomer();
    await addCollaborator(
      TEST_CUSTOMER_ID,
      SEED_IDS.staffA,
      TEST_COLLABORATOR_ROW_ID,
    );
    await db
      .update(schema.users)
      .set({ deletedAt: "2026-07-08T12:00:00.000Z" })
      .where(eq(schema.users.id, SEED_IDS.staffA));

    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationIds = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      ...completedInputBase,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    });

    assert.equal(notificationIds.length, 1);
    assert.deepEqual(await listNotificationUserIds(TEST_CUSTOMER_ID), [
      SEED_IDS.staffB,
    ]);
  });

  it("does not notify admin assignee", async () => {
    await resetTestCustomer();
    const now = new Date().toISOString();
    await db.insert(schema.customerAssignees).values({
      id: TEST_ADMIN_ASSIGNEE_ROW_ID,
      customerId: TEST_CUSTOMER_ID,
      userId: SEED_IDS.admin,
      role: "collaborator",
      assignedBy: SEED_IDS.admin,
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationIds = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      ...completedInputBase,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    });

    assert.equal(notificationIds.length, 1);
    assert.deepEqual(await listNotificationUserIds(TEST_CUSTOMER_ID), [
      SEED_IDS.staffB,
    ]);
  });

  it("notifies active assignee when ownerId is empty", async () => {
    await resetTestCustomer({ ownerId: null });
    await addCollaborator(
      TEST_CUSTOMER_ID,
      SEED_IDS.staffA,
      TEST_COLLABORATOR_ROW_ID,
    );
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationIds = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      ...completedInputBase,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    });

    assert.equal(notificationIds.length, 1);
    assert.deepEqual(await listNotificationUserIds(TEST_CUSTOMER_ID), [
      SEED_IDS.staffA,
    ]);
  });

  it("creates no notifications when ownerId is empty and there are no active assignees", async () => {
    await resetTestCustomer({ ownerId: null });
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationIds = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      ...completedInputBase,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    });

    assert.deepEqual(notificationIds, []);
    assert.deepEqual(await listNotificationUserIds(TEST_CUSTOMER_ID), []);
  });

  it("does not duplicate notification for same recipient + type + customerId", async () => {
    await resetTestCustomer();
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const input = {
      id: customer.id,
      customerName: customer.customerName,
      ...completedInputBase,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    };

    const firstIds = await notifyPendingSecondConversionIfEligible(db, input);
    const secondIds = await notifyPendingSecondConversionIfEligible(db, input);

    assert.equal(firstIds.length, 1);
    assert.deepEqual(secondIds, []);
    assert.equal(
      (await listNotificationUserIds(TEST_CUSTOMER_ID)).length,
      1,
    );
  });

  it("does not notify anyone when lifecycle is not completed", async () => {
    await resetTestCustomer();
    await addCollaborator(
      TEST_CUSTOMER_ID,
      SEED_IDS.staffA,
      TEST_COLLABORATOR_ROW_ID,
    );
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationIds = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      lifecycleStatus: null,
      status: customer.status,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    });

    assert.deepEqual(notificationIds, []);
    assert.deepEqual(await listNotificationUserIds(TEST_CUSTOMER_ID), []);
  });

  it("does not notify anyone for archived customers", async () => {
    await resetTestCustomer({ status: "archived", deletedAt: "2026-07-08T12:00:00.000Z" });
    await addCollaborator(
      TEST_CUSTOMER_ID,
      SEED_IDS.staffA,
      TEST_COLLABORATOR_ROW_ID,
    );
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationIds = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      lifecycleStatus: CUSTOMER_LIFECYCLE_COMPLETED,
      status: customer.status,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
      isArchived: true,
    });

    assert.deepEqual(notificationIds, []);
    assert.deepEqual(await listNotificationUserIds(TEST_CUSTOMER_ID), []);
  });

  it("does not notify anyone for public_pool customers", async () => {
    await resetTestCustomer({ status: "public_pool", ownerId: null });
    await addCollaborator(
      TEST_CUSTOMER_ID,
      SEED_IDS.staffA,
      TEST_COLLABORATOR_ROW_ID,
    );
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationIds = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      lifecycleStatus: CUSTOMER_LIFECYCLE_COMPLETED,
      status: customer.status,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    });

    assert.deepEqual(notificationIds, []);
    assert.deepEqual(await listNotificationUserIds(TEST_CUSTOMER_ID), []);
  });

  it("does not notify anyone when deletedAt is set", async () => {
    await resetTestCustomer();
    await addCollaborator(
      TEST_CUSTOMER_ID,
      SEED_IDS.staffA,
      TEST_COLLABORATOR_ROW_ID,
    );
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationIds = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      lifecycleStatus: CUSTOMER_LIFECYCLE_COMPLETED,
      status: "active",
      ownerId: customer.ownerId,
      deletedAt: "2026-07-08T12:00:00.000Z",
    });

    assert.deepEqual(notificationIds, []);
    assert.deepEqual(await listNotificationUserIds(TEST_CUSTOMER_ID), []);
  });

  it("works after lifecycle complete flow for owner notification", async () => {
    await resetTestCustomer();
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;
    const result = await completeCustomerLifecycle(db, {
      customer,
      actor: admin,
      now: "2026-07-08T16:00:00.000Z",
    });

    const notificationIds = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      lifecycleStatus: result.lifecycleStatus,
      status: result.status,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    });

    assert.equal(notificationIds.length, 1);
    assert.deepEqual(await listNotificationUserIds(TEST_CUSTOMER_ID), [
      SEED_IDS.staffB,
    ]);
  });
});
