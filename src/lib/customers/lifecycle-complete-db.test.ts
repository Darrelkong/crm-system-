import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  CUSTOMER_LIFECYCLE_COMPLETED,
  CUSTOMER_LIFECYCLE_COMPLETED_AUDIT_ACTION,
  LifecycleCompleteError,
  completeCustomerLifecycle,
} from "./lifecycle-complete";

const TEST_CUSTOMER_ID = SEED_IDS.customerStaffB;

const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;

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

async function resetTestCustomer(overrides: Partial<Customer> = {}) {
  await db
    .update(schema.customers)
    .set({
      salesStage: "paid",
      status: "active",
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

  await db
    .delete(schema.fieldChangeLogs)
    .where(eq(schema.fieldChangeLogs.customerId, TEST_CUSTOMER_ID));
  await db
    .delete(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.entityType, "customer"),
        eq(schema.auditLogs.entityId, TEST_CUSTOMER_ID),
        eq(schema.auditLogs.action, CUSTOMER_LIFECYCLE_COMPLETED_AUDIT_ACTION),
      ),
    );
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
  assert.ok(existing, "seed customer must exist for lifecycle DB tests");
  baselineCustomer = existing;
  await resetTestCustomer();
});

after(async () => {
  await db
    .update(schema.customers)
    .set({
      salesStage: baselineCustomer.salesStage,
      status: baselineCustomer.status,
      deletedAt: baselineCustomer.deletedAt,
      deletedBy: baselineCustomer.deletedBy,
      deletedReason: baselineCustomer.deletedReason,
      lifecycleStatus: baselineCustomer.lifecycleStatus,
      lifecycleCompletedAt: baselineCustomer.lifecycleCompletedAt,
      lifecycleCompletedBy: baselineCustomer.lifecycleCompletedBy,
      lifecycleCompletionNotes: baselineCustomer.lifecycleCompletionNotes,
      updatedAt: baselineCustomer.updatedAt,
      updatedBy: baselineCustomer.updatedBy,
    })
    .where(eq(schema.customers.id, TEST_CUSTOMER_ID));
  await db
    .delete(schema.fieldChangeLogs)
    .where(eq(schema.fieldChangeLogs.customerId, TEST_CUSTOMER_ID));
  await db
    .delete(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.entityType, "customer"),
        eq(schema.auditLogs.entityId, TEST_CUSTOMER_ID),
        eq(schema.auditLogs.action, CUSTOMER_LIFECYCLE_COMPLETED_AUDIT_ACTION),
      ),
    );
  bindTestDatabase(null);
  delete process.env.CRM_ALLOW_TEST_DB_BIND;
  await disposeProxy?.();
});

describe("completeCustomerLifecycle (CUSTOMER-FLOW-3A DB)", () => {
  it("allows admin to mark paid customer as completed", async () => {
    await resetTestCustomer();
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const result = await completeCustomerLifecycle(db, {
      customer,
      actor: admin,
      notes: "  服务已交付  ",
      now: "2026-07-08T14:00:00.000Z",
    });

    assert.equal(result.lifecycleStatus, CUSTOMER_LIFECYCLE_COMPLETED);
    assert.equal(result.lifecycleCompletedAt, "2026-07-08T14:00:00.000Z");
    assert.equal(result.lifecycleCompletedBy, admin.id);
    assert.equal(result.lifecycleCompletionNotes, "服务已交付");
    assert.equal(result.salesStage, "paid");
    assert.equal(result.status, "active");

    const updated = (await getCustomer(TEST_CUSTOMER_ID))!;
    assert.equal(updated.lifecycleStatus, CUSTOMER_LIFECYCLE_COMPLETED);
    assert.equal(updated.lifecycleCompletedAt, "2026-07-08T14:00:00.000Z");
    assert.equal(updated.lifecycleCompletedBy, admin.id);
    assert.equal(updated.lifecycleCompletionNotes, "服务已交付");
    assert.equal(updated.salesStage, "paid");
    assert.equal(updated.status, "active");
    assert.equal(updated.updatedBy, admin.id);
  });

  it("stores null when notes are empty", async () => {
    await resetTestCustomer();
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    const result = await completeCustomerLifecycle(db, {
      customer,
      actor: admin,
      notes: "   ",
    });

    assert.equal(result.lifecycleCompletionNotes, null);

    const updated = (await getCustomer(TEST_CUSTOMER_ID))!;
    assert.equal(updated.lifecycleCompletionNotes, null);
  });

  it("rejects staff", async () => {
    await resetTestCustomer();
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    await assert.rejects(
      () =>
        completeCustomerLifecycle(db, {
          customer,
          actor: staffA,
        }),
      (error: unknown) => {
        assert.ok(error instanceof LifecycleCompleteError);
        assert.equal(error.code, "ADMIN_REQUIRED");
        assert.equal(error.status, 403);
        return true;
      },
    );
  });

  it("rejects non-paid customers", async () => {
    await resetTestCustomer({ salesStage: "negotiation" });
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    await assert.rejects(
      () =>
        completeCustomerLifecycle(db, {
          customer,
          actor: admin,
        }),
      (error: unknown) => {
        assert.ok(error instanceof LifecycleCompleteError);
        assert.equal(error.code, "CUSTOMER_NOT_PAID");
        return true;
      },
    );
  });

  it("rejects archived customers with deletedAt", async () => {
    await resetTestCustomer({
      status: "archived",
      deletedAt: "2026-07-08T12:00:00.000Z",
      deletedBy: admin.id,
    });
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    await assert.rejects(
      () =>
        completeCustomerLifecycle(db, {
          customer,
          actor: admin,
        }),
      (error: unknown) => {
        assert.ok(error instanceof LifecycleCompleteError);
        assert.equal(error.code, "CUSTOMER_ARCHIVED");
        return true;
      },
    );
  });

  it("rejects public pool customers", async () => {
    await resetTestCustomer({ status: "public_pool" });
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    await assert.rejects(
      () =>
        completeCustomerLifecycle(db, {
          customer,
          actor: admin,
        }),
      (error: unknown) => {
        assert.ok(error instanceof LifecycleCompleteError);
        assert.equal(error.code, "CUSTOMER_IN_PUBLIC_POOL");
        return true;
      },
    );
  });

  it("rejects duplicate completion", async () => {
    await resetTestCustomer();
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    await completeCustomerLifecycle(db, { customer, actor: admin });
    const completed = (await getCustomer(TEST_CUSTOMER_ID))!;

    await assert.rejects(
      () =>
        completeCustomerLifecycle(db, {
          customer: completed,
          actor: admin,
        }),
      (error: unknown) => {
        assert.ok(error instanceof LifecycleCompleteError);
        assert.equal(error.code, "ALREADY_COMPLETED");
        assert.equal(error.status, 409);
        return true;
      },
    );
  });

  it("writes customer.lifecycle.completed audit log", async () => {
    await resetTestCustomer();
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    await completeCustomerLifecycle(db, {
      customer,
      actor: admin,
      notes: "done",
    });

    const auditRows = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityType, "customer"),
          eq(schema.auditLogs.entityId, TEST_CUSTOMER_ID),
          eq(
            schema.auditLogs.action,
            CUSTOMER_LIFECYCLE_COMPLETED_AUDIT_ACTION,
          ),
        ),
      );

    assert.equal(auditRows.length, 1);
    const metadata = JSON.parse(auditRows[0]!.metadata ?? "{}") as {
      customerName?: string;
      salesStage?: string;
      previousLifecycleStatus?: string | null;
      lifecycleStatus?: string;
      lifecycleCompletionNotes?: string | null;
    };
    assert.equal(metadata.customerName, customer.customerName);
    assert.equal(metadata.salesStage, "paid");
    assert.equal(metadata.previousLifecycleStatus, null);
    assert.equal(metadata.lifecycleStatus, CUSTOMER_LIFECYCLE_COMPLETED);
    assert.equal(metadata.lifecycleCompletionNotes, "done");
  });

  it("writes lifecycle_status field change log", async () => {
    await resetTestCustomer();
    const customer = (await getCustomer(TEST_CUSTOMER_ID))!;

    await completeCustomerLifecycle(db, { customer, actor: admin });

    const fieldRows = await db
      .select()
      .from(schema.fieldChangeLogs)
      .where(
        and(
          eq(schema.fieldChangeLogs.customerId, TEST_CUSTOMER_ID),
          eq(schema.fieldChangeLogs.fieldName, "lifecycle_status"),
        ),
      );

    assert.equal(fieldRows.length, 1);
    assert.equal(fieldRows[0]!.oldValue, null);
    assert.equal(fieldRows[0]!.newValue, CUSTOMER_LIFECYCLE_COMPLETED);
    assert.equal(fieldRows[0]!.changedBy, admin.id);
  });
});
