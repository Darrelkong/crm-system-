import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  adminDirectRemovePriority,
  adminDirectSetPriority,
  assertPriorityApprovalCanExecute,
  createPriorityApprovalRequest,
  findPendingPriorityApproval,
  PriorityCustomerError,
} from "./priority-customer-approval";
import { approveApprovalRequest, ApprovalError } from "@/lib/approvals/service";
import { getApprovalById } from "@/lib/approvals/queries";

const CUSTOMER_ID = SEED_IDS.customerStaffA;
const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

async function loadCustomer(db: TestDb, customerId: string) {
  const rows = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);
  return rows[0] ?? null;
}

async function resetCustomerPriorityState(
  db: TestDb,
  overrides: Partial<Customer> = {},
) {
  const now = new Date().toISOString();
  await db
    .update(schema.customers)
    .set({
      salesStage: "new_lead",
      isPinned: 0,
      pinnedAt: null,
      pinnedSource: null,
      updatedAt: now,
      ...overrides,
    })
    .where(eq(schema.customers.id, CUSTOMER_ID));
}

async function clearPriorityApprovals(db: TestDb, customerId: string) {
  await db.delete(schema.approvals).where(
    and(
      eq(schema.approvals.customerId, customerId),
      or(
        eq(schema.approvals.requestType, "set_priority_customer"),
        eq(schema.approvals.requestType, "unset_priority_customer"),
      ),
    ),
  );
}

describe("priority customer approval integration", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await resetCustomerPriorityState(db);
    await clearPriorityApprovals(db, CUSTOMER_ID);
  });

  after(async () => {
    await clearPriorityApprovals(db, CUSTOMER_ID);
    await resetCustomerPriorityState(db);
    bindTestDatabase(null);
    dispose?.();
  });

  it("admin set unpinned → admin_direct", async () => {
    await resetCustomerPriorityState(db);
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    const result = await adminDirectSetPriority(db, customer, admin);
    assert.equal(result, "updated");
    const updated = await loadCustomer(db, CUSTOMER_ID);
    assert.equal(updated?.isPinned, 1);
    assert.equal(updated?.pinnedSource, "admin_direct");
    assert.ok(updated?.pinnedAt);
  });

  it("admin set already priority → no_change", async () => {
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    const result = await adminDirectSetPriority(db, customer, admin);
    assert.equal(result, "no_change");
  });

  it("admin remove priority + non-on_hold → cleared", async () => {
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    await adminDirectRemovePriority(db, customer, admin);
    const updated = await loadCustomer(db, CUSTOMER_ID);
    assert.equal(updated?.isPinned, 0);
    assert.equal(updated?.pinnedSource, null);
    assert.equal(updated?.pinnedAt, null);
  });

  it("admin remove on_hold customer → blocked", async () => {
    await resetCustomerPriorityState(db, {
      salesStage: "on_hold",
      isPinned: 1,
      pinnedAt: "2026-08-14T10:00:00.000Z",
      pinnedSource: "on_hold_auto",
    });
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    await assert.rejects(
      () => adminDirectRemovePriority(db, customer, admin),
      (error: unknown) =>
        error instanceof PriorityCustomerError &&
        error.errorCode === "CUSTOMER_ON_HOLD_REQUIRES_PRIORITY",
    );
  });

  it("staff creates set approval without immediate mutation", async () => {
    await clearPriorityApprovals(db, CUSTOMER_ID);
    await resetCustomerPriorityState(db);
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    const { id } = await createPriorityApprovalRequest(
      db,
      customer,
      staffA,
      "set_priority_customer",
      "需要优先跟进此客户",
    );
    const pending = await findPendingPriorityApproval(db, CUSTOMER_ID);
    assert.equal(pending?.id, id);
    const unchanged = await loadCustomer(db, CUSTOMER_ID);
    assert.equal(unchanged?.isPinned, 0);
  });

  it("approve set request → approval source", async () => {
    const approval = await findPendingPriorityApproval(db, CUSTOMER_ID);
    assert.ok(approval);
    await approveApprovalRequest(approval.id, admin);
    const updated = await loadCustomer(db, CUSTOMER_ID);
    assert.equal(updated?.isPinned, 1);
    assert.equal(updated?.pinnedSource, "approval");
  });

  it("staff unset request blocked when on_hold", async () => {
    await resetCustomerPriorityState(db, {
      salesStage: "on_hold",
      isPinned: 1,
      pinnedAt: "2026-08-14T10:00:00.000Z",
      pinnedSource: "on_hold_auto",
    });
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    await assert.rejects(
      () =>
        createPriorityApprovalRequest(
          db,
          customer,
          staffA,
          "unset_priority_customer",
          "尝试取消",
        ),
      (error: unknown) => error instanceof PriorityCustomerError,
    );
  });

  it("concurrent set requests → exactly one pending", async () => {
    await clearPriorityApprovals(db, CUSTOMER_ID);
    await resetCustomerPriorityState(db);
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;

    const results = await Promise.allSettled([
      createPriorityApprovalRequest(
        db,
        customer,
        staffA,
        "set_priority_customer",
        "并发请求 A",
      ),
      createPriorityApprovalRequest(
        db,
        customer,
        staffA,
        "set_priority_customer",
        "并发请求 B",
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const pending = await findPendingPriorityApproval(db, CUSTOMER_ID);
    assert.ok(pending);
  });

  it("stale set approval after admin direct set", async () => {
    await clearPriorityApprovals(db, CUSTOMER_ID);
    await resetCustomerPriorityState(db);
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    const { id } = await createPriorityApprovalRequest(
      db,
      customer,
      staffA,
      "set_priority_customer",
      "员工申请",
    );
    const approval = (await getApprovalById(db, id))!;
    await adminDirectSetPriority(db, customer, admin);
    const refreshed = (await loadCustomer(db, CUSTOMER_ID))!;
    await assert.rejects(
      async () => {
        assertPriorityApprovalCanExecute(approval, refreshed);
      },
      (error: unknown) => error instanceof ApprovalError,
    );
  });

  it("staff cannot call admin direct set", async () => {
    await resetCustomerPriorityState(db);
    const customer = (await loadCustomer(db, CUSTOMER_ID))!;
    await assert.rejects(
      () => adminDirectSetPriority(db, customer, staffA),
      (error: unknown) => error instanceof PriorityCustomerError,
    );
  });
});
