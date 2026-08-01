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
  ApprovalError,
  approveApprovalRequest,
  createApprovalRequest,
  rejectApprovalRequest,
} from "./service";
import { createNotificationOnce } from "@/lib/notifications/service";
import { listActiveAdminUsers } from "@/lib/users/queries";

const CUSTOMER_ID = "a1aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa001";
const EXTRA_ADMIN_ID = "a1aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0ad";
const EXTRA_ADMIN_INACTIVE = "a1aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0ai";
const EXTRA_ADMIN_DELETED = "a1aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0dd";
const SECOND_APPROVAL_ID = "a1-second-approval-pending-001";

const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;

const CLOSED_WON_INPUT = {
  requestType: "closed_won" as const,
  reason: "成交申请测试理由足够长",
  payload: {
    dealAmount: "10000",
    signingDate: "2026-07-01",
  },
};

type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Db;
let disposeProxy: (() => Promise<void>) | undefined;

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  const now = "2026-07-20T12:00:00.000Z";
  return {
    id: CUSTOMER_ID,
    customerCode: "EF-A1-NOTIF",
    customerName: "[TEST] A1 approval notify",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000111",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    notes: null,
    salesStage: "negotiation",
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

async function cleanup() {
  const approvals = await db
    .select({ id: schema.approvals.id })
    .from(schema.approvals)
    .where(eq(schema.approvals.customerId, CUSTOMER_ID));
  const approvalIds = [
    ...approvals.map((row) => row.id),
    SECOND_APPROVAL_ID,
  ];

  await db
    .delete(schema.notifications)
    .where(
      and(
        eq(schema.notifications.relatedEntityType, "approval"),
        inArray(schema.notifications.relatedEntityId, approvalIds),
      ),
    );
  await db
    .delete(schema.notifications)
    .where(
      and(
        eq(schema.notifications.relatedEntityType, "customer"),
        eq(schema.notifications.relatedEntityId, CUSTOMER_ID),
      ),
    );
  await db
    .delete(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.entityType, "approval"),
        inArray(schema.auditLogs.entityId, approvalIds),
      ),
    );
  await db
    .delete(schema.auditLogs)
    .where(eq(schema.auditLogs.entityId, CUSTOMER_ID));
  await db
    .delete(schema.fieldChangeLogs)
    .where(eq(schema.fieldChangeLogs.customerId, CUSTOMER_ID));
  await db
    .delete(schema.approvals)
    .where(eq(schema.approvals.customerId, CUSTOMER_ID));
  await db
    .delete(schema.customers)
    .where(eq(schema.customers.id, CUSTOMER_ID));
  await db
    .delete(schema.users)
    .where(
      inArray(schema.users.id, [
        EXTRA_ADMIN_ID,
        EXTRA_ADMIN_INACTIVE,
        EXTRA_ADMIN_DELETED,
      ]),
    );
}

async function seedCustomer(overrides: Partial<Customer> = {}) {
  await cleanup();
  await db.insert(schema.customers).values(makeCustomer(overrides));
}

async function seedExtraAdmins() {
  const now = "2026-07-20T12:00:00.000Z";
  await db.insert(schema.users).values([
    {
      id: EXTRA_ADMIN_ID,
      email: "a1-extra-admin@test.local",
      displayName: "A1 Extra Admin",
      role: "admin",
      passwordHash: "x",
      isActive: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: EXTRA_ADMIN_INACTIVE,
      email: "a1-inactive-admin@test.local",
      displayName: "A1 Inactive Admin",
      role: "admin",
      passwordHash: "x",
      isActive: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: EXTRA_ADMIN_DELETED,
      email: "a1-deleted-admin@test.local",
      displayName: "A1 Deleted Admin",
      role: "admin",
      passwordHash: "x",
      isActive: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: now,
    },
  ]);
}

async function listApprovalNotifications(
  approvalId: string,
  type: "approval.pending" | "approval.approved" | "approval.rejected",
) {
  return db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.relatedEntityType, "approval"),
        eq(schema.notifications.relatedEntityId, approvalId),
        eq(schema.notifications.type, type),
      ),
    );
}

describe("Notifications Round A1 approval pending/result + CAS", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("pending notifies each active admin once; skips inactive/deleted; dedups retry", async () => {
    await seedCustomer();
    await seedExtraAdmins();
    const customer = makeCustomer();

    const activeAdmins = await listActiveAdminUsers();
    const activeIds = new Set(activeAdmins.map((row) => row.id));
    assert.ok(activeIds.has(SEED_IDS.admin));
    assert.ok(activeIds.has(EXTRA_ADMIN_ID));
    assert.equal(activeIds.has(EXTRA_ADMIN_INACTIVE), false);
    assert.equal(activeIds.has(EXTRA_ADMIN_DELETED), false);

    const { id } = await createApprovalRequest(customer, staffA, CLOSED_WON_INPUT);

    const pending = await listApprovalNotifications(id, "approval.pending");
    assert.equal(pending.length, activeIds.size);
    for (const row of pending) {
      assert.ok(activeIds.has(row.userId));
    }
    assert.equal(
      pending.some((row) => row.userId === EXTRA_ADMIN_INACTIVE),
      false,
    );
    assert.equal(
      pending.some((row) => row.userId === EXTRA_ADMIN_DELETED),
      false,
    );
    assert.equal(
      pending.some((row) => row.userId === SEED_IDS.staffA),
      false,
    );

    const before = pending.length;
    await createNotificationOnce(db, {
      userId: SEED_IDS.admin,
      type: "approval.pending",
      title: "retry",
      message: "retry",
      relatedEntityType: "approval",
      relatedEntityId: id,
    });
    const after = await listApprovalNotifications(id, "approval.pending");
    assert.equal(after.length, before);

    const second = await createNotificationOnce(db, {
      userId: SEED_IDS.admin,
      type: "approval.pending",
      title: "second",
      message: "second",
      relatedEntityType: "approval",
      relatedEntityId: SECOND_APPROVAL_ID,
    });
    assert.equal(second.created, true);
  });

  it("requester who is admin still receives pending (existing behavior)", async () => {
    await seedCustomer();
    const customer = makeCustomer();
    const { id } = await createApprovalRequest(customer, admin, {
      ...CLOSED_WON_INPUT,
      reason: "管理员本人申请成交理由足够",
    });

    const pending = await listApprovalNotifications(id, "approval.pending");
    assert.ok(pending.some((row) => row.userId === SEED_IDS.admin));
  });

  it("approve CAS: second approve stops without action/audit/notify; pending kept", async () => {
    await seedCustomer({ salesStage: "negotiation" });
    const customer = makeCustomer({ salesStage: "negotiation" });
    const { id } = await createApprovalRequest(customer, staffA, {
      ...CLOSED_WON_INPUT,
      reason: "CAS approve 测试理由足够长",
    });

    const pendingBefore = await listApprovalNotifications(id, "approval.pending");
    assert.ok(pendingBefore.length >= 1);

    await approveApprovalRequest(id, admin, "ok");

    const approved = await getApprovalById(db, id);
    assert.equal(approved?.status, "approved");

    const approvedNotifs = await listApprovalNotifications(id, "approval.approved");
    assert.equal(approvedNotifs.length, 1);
    assert.equal(approvedNotifs[0]?.userId, SEED_IDS.staffA);

    const pendingAfter = await listApprovalNotifications(id, "approval.pending");
    assert.equal(pendingAfter.length, pendingBefore.length);

    const auditsBefore = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityType, "approval"),
          eq(schema.auditLogs.entityId, id),
          eq(schema.auditLogs.action, APPROVAL_AUDIT_ACTIONS.approved),
        ),
      );

    await assert.rejects(
      () => approveApprovalRequest(id, admin, "again"),
      (error: unknown) =>
        error instanceof ApprovalError &&
        error.status === 409 &&
        error.message === "该申请已处理，不能重复审批",
    );

    const auditsAfter = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityType, "approval"),
          eq(schema.auditLogs.entityId, id),
          eq(schema.auditLogs.action, APPROVAL_AUDIT_ACTIONS.approved),
        ),
      );
    assert.equal(auditsAfter.length, auditsBefore.length);

    const approvedNotifsAfter = await listApprovalNotifications(
      id,
      "approval.approved",
    );
    assert.equal(approvedNotifsAfter.length, 1);

    const closedWon = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.type, "customer.closed_won.approved"),
          eq(schema.notifications.relatedEntityType, "customer"),
          eq(schema.notifications.relatedEntityId, CUSTOMER_ID),
        ),
      );
    assert.equal(closedWon.length, 1);
  });

  it("reject CAS: second reject stops; approved/rejected types stay separate", async () => {
    await seedCustomer({ salesStage: "negotiation" });
    const customer = makeCustomer({ salesStage: "negotiation" });
    const { id } = await createApprovalRequest(customer, staffA, {
      ...CLOSED_WON_INPUT,
      reason: "CAS reject 测试理由足够长",
    });

    const pendingBefore = await listApprovalNotifications(id, "approval.pending");
    await rejectApprovalRequest(id, admin, "资料不足请补充");

    const rejected = await getApprovalById(db, id);
    assert.equal(rejected?.status, "rejected");

    const rejectedNotifs = await listApprovalNotifications(id, "approval.rejected");
    assert.equal(rejectedNotifs.length, 1);

    const pendingAfter = await listApprovalNotifications(id, "approval.pending");
    assert.equal(pendingAfter.length, pendingBefore.length);

    await assert.rejects(
      () => rejectApprovalRequest(id, admin, "再次拒绝"),
      (error: unknown) =>
        error instanceof ApprovalError && error.status === 409,
    );

    assert.equal(
      (await listApprovalNotifications(id, "approval.rejected")).length,
      1,
    );
    assert.equal(
      (await listApprovalNotifications(id, "approval.approved")).length,
      0,
    );
  });

  it("approve then reject: only approve wins; reject is 409 loser", async () => {
    await seedCustomer({ salesStage: "negotiation" });
    const customer = makeCustomer({ salesStage: "negotiation" });
    const { id } = await createApprovalRequest(customer, staffA, {
      ...CLOSED_WON_INPUT,
      reason: "竞态 approve 优先理由足够长",
    });

    await approveApprovalRequest(id, admin);
    await assert.rejects(
      () => rejectApprovalRequest(id, admin, "过晚拒绝"),
      (error: unknown) =>
        error instanceof ApprovalError && error.status === 409,
    );

    const row = await getApprovalById(db, id);
    assert.equal(row?.status, "approved");
    assert.equal(
      (await listApprovalNotifications(id, "approval.rejected")).length,
      0,
    );
  });

  it("duplicate result notification does not insert again", async () => {
    await seedCustomer({ salesStage: "negotiation" });
    const customer = makeCustomer({ salesStage: "negotiation" });
    const { id } = await createApprovalRequest(customer, staffA, {
      ...CLOSED_WON_INPUT,
      reason: "结果通知去重理由足够长",
    });
    await approveApprovalRequest(id, admin);

    const again = await createNotificationOnce(db, {
      userId: SEED_IDS.staffA,
      type: "approval.approved",
      title: "dup",
      message: "dup",
      relatedEntityType: "approval",
      relatedEntityId: id,
    });
    assert.equal(again.created, false);
    assert.equal(
      (await listApprovalNotifications(id, "approval.approved")).length,
      1,
    );
  });
});
