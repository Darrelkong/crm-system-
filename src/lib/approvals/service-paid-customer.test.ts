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
import { APPROVAL_AUDIT_ACTIONS } from "./constants";
import { getApprovalById } from "./queries";
import {
  ApprovalError,
  approveApprovalRequest,
  createApprovalRequest,
  rejectApprovalRequest,
} from "./service";

const CUSTOMER_ID = SEED_IDS.customerStaffB;

const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;

const VALID_PAID_PAYLOAD = {
  serviceItems: "顾问服务",
  paidAmount: "5000",
  paidAt: "2026-07-01",
};

function makeCustomer(overrides: Partial<Customer> & Pick<Customer, "id">): Customer {
  const now = "2026-06-28T12:00:00.000Z";
  return {
    customerCode: "EF-200",
    customerName: "付款测试客户",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000002",
    wechatId: "wx_paid",
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: "项目",
    notes: null,
    salesStage: "negotiation",
    status: "active",
    ownerId: SEED_IDS.staffA,
    releaserUserId: null,
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

async function clearPaidApprovals(
  db: ReturnType<typeof drizzle<typeof schema>>,
  customerId: string,
) {
  await db
    .delete(schema.approvals)
    .where(
      and(
        eq(schema.approvals.customerId, customerId),
        eq(schema.approvals.requestType, "paid_customer"),
      ),
    );
}

async function resetCustomerStage(
  db: ReturnType<typeof drizzle<typeof schema>>,
  customerId: string,
  salesStage: string,
) {
  const now = new Date().toISOString();
  await db
    .update(schema.customers)
    .set({ salesStage, updatedAt: now })
    .where(eq(schema.customers.id, customerId));
}

describe("paid_customer approval service", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dispose: (() => Promise<void>) | undefined;
  let activeCustomer: Customer;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    activeCustomer = makeCustomer({ id: CUSTOMER_ID });
    await clearPaidApprovals(db, CUSTOMER_ID);
    await resetCustomerStage(db, CUSTOMER_ID, "negotiation");
  });

  after(async () => {
    await clearPaidApprovals(db, CUSTOMER_ID);
    await resetCustomerStage(db, CUSTOMER_ID, "negotiation");
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("creates a pending paid_customer approval request", async () => {
    await clearPaidApprovals(db, CUSTOMER_ID);

    const result = await createApprovalRequest(activeCustomer, staffA, {
      requestType: "paid_customer",
      reason: "客户已完成付款",
      payload: VALID_PAID_PAYLOAD,
    });

    assert.ok(result.id, "should return an id");

    const approval = await getApprovalById(db, result.id);
    assert.ok(approval, "approval should exist in DB");
    assert.equal(approval.requestType, "paid_customer");
    assert.equal(approval.status, "pending");
    assert.equal(approval.customerId, CUSTOMER_ID);
    assert.equal(approval.requestedBy, SEED_IDS.staffA);

    const payload = JSON.parse(approval.payload ?? "{}") as Record<string, unknown>;
    assert.equal(payload.serviceItems, VALID_PAID_PAYLOAD.serviceItems);
    assert.equal(payload.paidAmount, VALID_PAID_PAYLOAD.paidAmount);
    assert.equal(payload.paidAt, VALID_PAID_PAYLOAD.paidAt);

    await clearPaidApprovals(db, CUSTOMER_ID);
  });

  it("approve paid_customer sets salesStage = paid and writes audit log", async () => {
    await clearPaidApprovals(db, CUSTOMER_ID);
    await resetCustomerStage(db, CUSTOMER_ID, "negotiation");

    const { id: approvalId } = await createApprovalRequest(activeCustomer, staffA, {
      requestType: "paid_customer",
      reason: "客户已完成付款",
      payload: VALID_PAID_PAYLOAD,
    });

    await approveApprovalRequest(approvalId, admin);

    const approval = await getApprovalById(db, approvalId);
    assert.equal(approval?.status, "approved");
    assert.equal(approval?.reviewedBy, SEED_IDS.admin);

    const customerRows = await db
      .select({ salesStage: schema.customers.salesStage })
      .from(schema.customers)
      .where(eq(schema.customers.id, CUSTOMER_ID))
      .limit(1);
    assert.equal(customerRows[0]?.salesStage, "paid", "salesStage should be paid after approval");

    const auditRows = await db
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, CUSTOMER_ID),
          eq(schema.auditLogs.action, APPROVAL_AUDIT_ACTIONS.customerPaidApproved),
        ),
      );
    assert.ok(auditRows.length > 0, "should have customerPaidApproved audit log");

    await clearPaidApprovals(db, CUSTOMER_ID);
    await resetCustomerStage(db, CUSTOMER_ID, "negotiation");
  });

  it("reject paid_customer does not change salesStage", async () => {
    await clearPaidApprovals(db, CUSTOMER_ID);
    await resetCustomerStage(db, CUSTOMER_ID, "negotiation");

    const { id: approvalId } = await createApprovalRequest(activeCustomer, staffA, {
      requestType: "paid_customer",
      reason: "客户已完成付款",
      payload: VALID_PAID_PAYLOAD,
    });

    await rejectApprovalRequest(approvalId, admin, "资料不完整，请补充");

    const approval = await getApprovalById(db, approvalId);
    assert.equal(approval?.status, "rejected");

    const customerRows = await db
      .select({ salesStage: schema.customers.salesStage })
      .from(schema.customers)
      .where(eq(schema.customers.id, CUSTOMER_ID))
      .limit(1);
    assert.equal(
      customerRows[0]?.salesStage,
      "negotiation",
      "salesStage should remain negotiation after rejection",
    );

    await clearPaidApprovals(db, CUSTOMER_ID);
  });

  it("duplicate paid_customer approval is rejected with 409", async () => {
    await clearPaidApprovals(db, CUSTOMER_ID);

    await createApprovalRequest(activeCustomer, staffA, {
      requestType: "paid_customer",
      reason: "第一次申请",
      payload: VALID_PAID_PAYLOAD,
    });

    await assert.rejects(
      () =>
        createApprovalRequest(activeCustomer, staffA, {
          requestType: "paid_customer",
          reason: "重复申请",
          payload: VALID_PAID_PAYLOAD,
        }),
      (error: unknown) =>
        error instanceof ApprovalError &&
        error.status === 409 &&
        error.code === "duplicate_pending",
    );

    await clearPaidApprovals(db, CUSTOMER_ID);
  });

  it("paid_customer approval requires valid payload — rejects missing serviceItems at service layer", async () => {
    await assert.rejects(
      () =>
        createApprovalRequest(activeCustomer, staffA, {
          requestType: "paid_customer",
          reason: "缺少服务项目",
          payload: { paidAmount: "5000", paidAt: "2026-07-01" },
        }),
      (error: unknown) =>
        error instanceof ApprovalError && error.status === 400,
    );
  });

  it("paid_customer approval requires valid payload — rejects zero paidAmount at service layer", async () => {
    await assert.rejects(
      () =>
        createApprovalRequest(activeCustomer, staffA, {
          requestType: "paid_customer",
          reason: "金额为零",
          payload: { serviceItems: "顾问服务", paidAmount: "0", paidAt: "2026-07-01" },
        }),
      (error: unknown) =>
        error instanceof ApprovalError && error.status === 400,
    );
  });

  it("closed_won approval flow still works correctly", async () => {
    const closedWonApprovalId = `test-cw-sanity-${Date.now()}`;
    const now = new Date().toISOString();

    await db.insert(schema.approvals).values({
      id: closedWonApprovalId,
      requestType: "closed_won",
      status: "pending",
      customerId: CUSTOMER_ID,
      requestedBy: SEED_IDS.staffA,
      payload: JSON.stringify({ dealAmount: "10000", signingDate: "2026-07-01" }),
      reason: "正式成交",
      createdAt: now,
      updatedAt: now,
    });

    await approveApprovalRequest(closedWonApprovalId, admin);

    const customerRows = await db
      .select({ salesStage: schema.customers.salesStage })
      .from(schema.customers)
      .where(eq(schema.customers.id, CUSTOMER_ID))
      .limit(1);
    assert.equal(customerRows[0]?.salesStage, "closed_won");

    await db
      .delete(schema.approvals)
      .where(eq(schema.approvals.id, closedWonApprovalId));
    await resetCustomerStage(db, CUSTOMER_ID, "negotiation");
  });
});
