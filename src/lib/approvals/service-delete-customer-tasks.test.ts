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
import { getApprovalById } from "./queries";
import {
  approveApprovalRequest,
  createApprovalRequest,
  rejectApprovalRequest,
} from "./service";

const TEST_CUSTOMER_ID = "a4444444-4444-4444-4444-444444444401";
const OPEN_FOLLOW_UP = "a4444444-4444-4444-4444-444444444411";
const OPEN_FIRST = "a4444444-4444-4444-4444-444444444412";
const COMPLETED_ID = "a4444444-4444-4444-4444-444444444413";
const CANCELLED_ID = "a4444444-4444-4444-4444-444444444414";

const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const FIXED_NOW = "2026-07-30T12:00:00.000Z";

function makeCustomer(): Customer {
  return {
    id: TEST_CUSTOMER_ID,
    customerCode: "EF-DEL-APPR",
    customerName: "[TEST] Delete approval customer",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000991",
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
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
  } as Customer;
}

describe("delete_customer approval task cancellation", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dispose: (() => Promise<void>) | undefined;

  async function cleanup() {
    await db
      .delete(schema.tasks)
      .where(
        inArray(schema.tasks.id, [
          OPEN_FOLLOW_UP,
          OPEN_FIRST,
          COMPLETED_ID,
          CANCELLED_ID,
        ]),
      );
    await db
      .delete(schema.approvals)
      .where(eq(schema.approvals.customerId, TEST_CUSTOMER_ID));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, TEST_CUSTOMER_ID));
    await db
      .delete(schema.fieldChangeLogs)
      .where(eq(schema.fieldChangeLogs.customerId, TEST_CUSTOMER_ID));
    await db
      .delete(schema.customers)
      .where(eq(schema.customers.id, TEST_CUSTOMER_ID));
  }

  async function seedCustomerWithTasks() {
    await cleanup();
    const customer = makeCustomer();
    await db.insert(schema.customers).values(customer);
    await db.insert(schema.tasks).values([
      {
        id: OPEN_FOLLOW_UP,
        customerId: TEST_CUSTOMER_ID,
        assignedTo: SEED_IDS.staffA,
        createdBy: SEED_IDS.admin,
        title: "跟进",
        type: "follow_up",
        status: "open",
        dueAt: FIXED_NOW,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      },
      {
        id: OPEN_FIRST,
        customerId: TEST_CUSTOMER_ID,
        assignedTo: SEED_IDS.staffA,
        createdBy: SEED_IDS.admin,
        title: "首次",
        type: "first_contact",
        status: "open",
        dueAt: FIXED_NOW,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      },
      {
        id: COMPLETED_ID,
        customerId: TEST_CUSTOMER_ID,
        assignedTo: SEED_IDS.staffA,
        createdBy: SEED_IDS.admin,
        title: "完成",
        type: "follow_up",
        status: "completed",
        completedAt: FIXED_NOW,
        dueAt: FIXED_NOW,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      },
      {
        id: CANCELLED_ID,
        customerId: TEST_CUSTOMER_ID,
        assignedTo: SEED_IDS.staffA,
        createdBy: SEED_IDS.admin,
        title: "取消",
        type: "follow_up",
        status: "cancelled",
        dueAt: FIXED_NOW,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      },
    ]);
    return customer;
  }

  async function taskStatuses() {
    const rows = await db
      .select({
        id: schema.tasks.id,
        status: schema.tasks.status,
        completedAt: schema.tasks.completedAt,
      })
      .from(schema.tasks)
      .where(eq(schema.tasks.customerId, TEST_CUSTOMER_ID));
    return Object.fromEntries(rows.map((row) => [row.id, row]));
  }

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("pending delete_customer does not archive or cancel tasks", async () => {
    const customer = await seedCustomerWithTasks();
    const { id } = await createApprovalRequest(customer, staffA, {
      requestType: "delete_customer",
      reason: "客户要求删除资料",
    });

    const approval = await getApprovalById(db, id);
    assert.equal(approval?.status, "pending");

    const customerRow = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, TEST_CUSTOMER_ID))
      .limit(1);
    assert.equal(customerRow[0]?.status, "active");
    assert.equal(customerRow[0]?.deletedAt, null);

    const statuses = await taskStatuses();
    assert.equal(statuses[OPEN_FOLLOW_UP]?.status, "open");
    assert.equal(statuses[OPEN_FIRST]?.status, "open");
    assert.equal(statuses[COMPLETED_ID]?.status, "completed");
    assert.equal(statuses[CANCELLED_ID]?.status, "cancelled");
  });

  it("rejected delete_customer does not archive or cancel tasks", async () => {
    const customer = await seedCustomerWithTasks();
    const { id } = await createApprovalRequest(customer, staffA, {
      requestType: "delete_customer",
      reason: "客户要求删除资料",
    });

    await rejectApprovalRequest(id, admin, "暂不删除");

    const approval = await getApprovalById(db, id);
    assert.equal(approval?.status, "rejected");

    const customerRow = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, TEST_CUSTOMER_ID))
      .limit(1);
    assert.equal(customerRow[0]?.status, "active");
    assert.equal(customerRow[0]?.deletedAt, null);

    const statuses = await taskStatuses();
    assert.equal(statuses[OPEN_FOLLOW_UP]?.status, "open");
    assert.equal(statuses[OPEN_FIRST]?.status, "open");
    assert.equal(statuses[COMPLETED_ID]?.status, "completed");
    assert.equal(statuses[CANCELLED_ID]?.status, "cancelled");
  });

  it("approved delete_customer archives and cancels open tasks in one batch", async () => {
    const customer = await seedCustomerWithTasks();
    const { id } = await createApprovalRequest(customer, staffA, {
      requestType: "delete_customer",
      reason: "客户要求删除资料",
    });

    await approveApprovalRequest(id, admin);

    const approval = await getApprovalById(db, id);
    assert.equal(approval?.status, "approved");

    const customerRow = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, TEST_CUSTOMER_ID))
      .limit(1);
    assert.equal(customerRow[0]?.status, "archived");
    assert.ok(customerRow[0]?.deletedAt);
    assert.equal(customerRow[0]?.deletedBy, SEED_IDS.admin);

    const statuses = await taskStatuses();
    assert.equal(statuses[OPEN_FOLLOW_UP]?.status, "cancelled");
    assert.equal(statuses[OPEN_FIRST]?.status, "cancelled");
    assert.equal(statuses[COMPLETED_ID]?.status, "completed");
    assert.equal(statuses[COMPLETED_ID]?.completedAt, FIXED_NOW);
    assert.equal(statuses[CANCELLED_ID]?.status, "cancelled");

    const softAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, TEST_CUSTOMER_ID),
          eq(schema.auditLogs.action, APPROVAL_AUDIT_ACTIONS.customerDeletedSoft),
        ),
      );
    assert.ok(softAudits.length >= 1);
    const metadata = JSON.parse(softAudits[0]!.metadata ?? "{}") as Record<
      string,
      unknown
    >;
    assert.equal(metadata.taskCancelReasonCode, "soft_archive");
    assert.equal("cancelledOpenTaskCount" in metadata, false);
    assert.equal("title" in metadata, false);
  });
});
