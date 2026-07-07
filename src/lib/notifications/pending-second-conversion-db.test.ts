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
const admin = { id: SEED_IDS.admin, role: "admin" } as User;

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let baselineCustomer: Customer;

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

  await deletePendingSecondConversionNotifications(TEST_CUSTOMER_ID);
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
  await deletePendingSecondConversionNotifications(TEST_CUSTOMER_ID);
  bindTestDatabase(null);
  delete process.env.CRM_ALLOW_TEST_DB_BIND;
  await disposeProxy?.();
});

describe("notifyPendingSecondConversionIfEligible (CUSTOMER-FLOW-3B-3 DB)", () => {
  it("creates notification for completed active customer with ownerId", async () => {
    await resetTestCustomer();
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;
    const result = await completeCustomerLifecycle(db, {
      customer,
      actor: admin,
      now: "2026-07-08T16:00:00.000Z",
    });

    const notificationId = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      lifecycleStatus: result.lifecycleStatus,
      status: result.status,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    });

    assert.ok(notificationId);

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, notificationId));

    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.userId, SEED_IDS.staffB);
    assert.equal(rows[0]!.type, PENDING_SECOND_CONVERSION_NOTIFICATION_TYPE);
    assert.equal(rows[0]!.relatedEntityType, "customer");
    assert.equal(rows[0]!.relatedEntityId, TEST_CUSTOMER_ID);
  });

  it("does not create notification when lifecycle is not completed", async () => {
    await resetTestCustomer();
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationId = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      lifecycleStatus: null,
      status: customer.status,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    });

    assert.equal(notificationId, null);
  });

  it("does not create notification for archived customers", async () => {
    await resetTestCustomer({ status: "archived", deletedAt: "2026-07-08T12:00:00.000Z" });
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationId = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      lifecycleStatus: CUSTOMER_LIFECYCLE_COMPLETED,
      status: customer.status,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
      isArchived: true,
    });

    assert.equal(notificationId, null);
  });

  it("does not create notification for public_pool customers", async () => {
    await resetTestCustomer({ status: "public_pool", ownerId: null });
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationId = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      lifecycleStatus: CUSTOMER_LIFECYCLE_COMPLETED,
      status: customer.status,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    });

    assert.equal(notificationId, null);
  });

  it("does not create notification when deletedAt is set", async () => {
    await resetTestCustomer();
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationId = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      lifecycleStatus: CUSTOMER_LIFECYCLE_COMPLETED,
      status: "active",
      ownerId: customer.ownerId,
      deletedAt: "2026-07-08T12:00:00.000Z",
    });

    assert.equal(notificationId, null);
  });

  it("does not create notification when ownerId is empty", async () => {
    await resetTestCustomer({ ownerId: null });
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const notificationId = await notifyPendingSecondConversionIfEligible(db, {
      id: customer.id,
      customerName: customer.customerName,
      lifecycleStatus: CUSTOMER_LIFECYCLE_COMPLETED,
      status: customer.status,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    });

    assert.equal(notificationId, null);
  });

  it("does not duplicate notification for same owner + type + customerId", async () => {
    await resetTestCustomer();
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const input = {
      id: customer.id,
      customerName: customer.customerName,
      lifecycleStatus: CUSTOMER_LIFECYCLE_COMPLETED,
      status: "active" as const,
      ownerId: customer.ownerId,
      deletedAt: customer.deletedAt,
    };

    const firstId = await notifyPendingSecondConversionIfEligible(db, input);
    const secondId = await notifyPendingSecondConversionIfEligible(db, input);

    assert.ok(firstId);
    assert.equal(secondId, null);

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, SEED_IDS.staffB),
          eq(
            schema.notifications.type,
            PENDING_SECOND_CONVERSION_NOTIFICATION_TYPE,
          ),
          eq(schema.notifications.relatedEntityId, TEST_CUSTOMER_ID),
        ),
      );

    assert.equal(rows.length, 1);
  });
});
