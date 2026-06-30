import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { APPROVAL_AUDIT_ACTIONS } from "./constants";
import { MERGE_CUSTOMERS_DISABLED_CODE } from "./errors";
import { getApprovalById } from "./queries";
import {
  ApprovalError,
  approveApprovalRequest,
  createApprovalRequest,
} from "./service";

const CUSTOMER_ID = SEED_IDS.customerStaffA;
const MERGE_APPROVAL_ID = "test-merge-approval-disabled-001";

const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;

function makeCustomer(overrides: Partial<Customer> & Pick<Customer, "id">): Customer {
  const now = "2026-06-28T12:00:00.000Z";
  return {
    customerCode: "EF-100",
    customerName: "测试客户",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000001",
    wechatId: "wx",
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: "项目",
    notes: null,
    salesStage: "new_lead",
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

async function clearMergeApprovals(
  db: ReturnType<typeof drizzle<typeof schema>>,
  customerId: string,
) {
  await db
    .delete(schema.approvals)
    .where(
      and(
        eq(schema.approvals.customerId, customerId),
        eq(schema.approvals.requestType, "merge_customers"),
      ),
    );
}

async function seedPendingMergeApproval(
  db: ReturnType<typeof drizzle<typeof schema>>,
  customerId: string,
) {
  const now = new Date().toISOString();
  await db.insert(schema.approvals).values({
    id: MERGE_APPROVAL_ID,
    requestType: "merge_customers",
    status: "pending",
    customerId,
    requestedBy: SEED_IDS.staffA,
    relatedCustomerIds: JSON.stringify([SEED_IDS.customerStaffB]),
    reason: "疑似重复客户",
    createdAt: now,
    updatedAt: now,
  });
}

describe("merge_customers approval disabled service", () => {
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
    await clearMergeApprovals(db, CUSTOMER_ID);
  });

  after(async () => {
    await clearMergeApprovals(db, CUSTOMER_ID);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("rejects createApprovalRequest for merge_customers", async () => {
    await assert.rejects(
      () =>
        createApprovalRequest(activeCustomer, staffA, {
          requestType: "merge_customers",
          reason: "疑似重复客户",
          relatedCustomerIds: [SEED_IDS.customerStaffB],
        }),
      (error: unknown) =>
        error instanceof ApprovalError &&
        error.code === MERGE_CUSTOMERS_DISABLED_CODE &&
        error.status === 403,
    );
  });

  it("rejects approveApprovalRequest for pending merge_customers", async () => {
    await seedPendingMergeApproval(db, CUSTOMER_ID);

    await assert.rejects(
      () => approveApprovalRequest(MERGE_APPROVAL_ID, admin),
      (error: unknown) =>
        error instanceof ApprovalError &&
        error.code === MERGE_CUSTOMERS_DISABLED_CODE &&
        error.status === 403,
    );

    const approval = await getApprovalById(db, MERGE_APPROVAL_ID);
    assert.equal(approval?.status, "pending");
    assert.equal(approval?.reviewedBy, null);
    assert.equal(approval?.reviewedAt, null);

    const auditRows = await db
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, MERGE_APPROVAL_ID),
          inArray(schema.auditLogs.action, [
            APPROVAL_AUDIT_ACTIONS.approved,
            APPROVAL_AUDIT_ACTIONS.mergeApprovedPlaceholder,
          ]),
        ),
      );
    assert.equal(auditRows.length, 0);

    const notificationRows = await db
      .select({ type: schema.notifications.type })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.relatedEntityId, MERGE_APPROVAL_ID),
          eq(schema.notifications.type, "approval.approved"),
        ),
      );
    assert.equal(notificationRows.length, 0);

    await clearMergeApprovals(db, CUSTOMER_ID);
  });
});
