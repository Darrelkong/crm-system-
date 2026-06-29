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
import { listCustomerAssignees } from "./assignees";
import {
  applyCollaboratorAssignees,
} from "./assignees-mutations";
import {
  createCustomerAssigneeUpdateApprovalRequest,
  executeApprovedAssigneeUpdate,
  toAssigneeApprovalPermissionError,
} from "./assignees-approval";
import {
  ASSIGNEE_REASON_MIN_LENGTH,
  parseAssigneeUpdateApprovalPayload,
  validateAssigneeApprovalReason,
} from "./assignees-validation";
import { ON_HOLD_CREATE_APPROVAL_TYPE } from "./on-hold-create-pending";
import { approveApprovalRequest } from "@/lib/approvals/service";
import { getApprovalById } from "@/lib/approvals/queries";
import { PermissionError } from "@/lib/permissions/customers";

const CUSTOMER_ID = SEED_IDS.customerStaffA;
const PUBLIC_POOL_ID = SEED_IDS.customerPublicPool;
const MISSING_USER_ID = "00000000-0000-0000-0000-000000000099";
const PENDING_APPROVAL_ID = "test-assignee-pending-on-hold";
const ASSIGNEE_APPROVAL_ID = "test-assignee-approval-001";

const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;

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

async function clearCollaborators(
  db: ReturnType<typeof drizzle<typeof schema>>,
  customerId: string,
) {
  await db
    .delete(schema.customerAssignees)
    .where(eq(schema.customerAssignees.customerId, customerId));
  const now = new Date().toISOString();
  await db.insert(schema.customerAssignees).values({
    id: `ca_${customerId}_${SEED_IDS.staffA}`,
    customerId,
    userId: SEED_IDS.staffA,
    role: "primary",
    assignedBy: SEED_IDS.admin,
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

async function clearAssigneeApprovals(
  db: ReturnType<typeof drizzle<typeof schema>>,
  customerId: string,
) {
  await db
    .delete(schema.approvals)
    .where(
      eq(schema.approvals.customerId, customerId),
    );
}

function expectAssigneeApprovalError(
  fn: () => Promise<unknown>,
  errorCode: string,
) {
  return assert.rejects(fn, (error: unknown) => {
    const mapped = toAssigneeApprovalPermissionError(error);
    if (mapped?.errorCode === errorCode) {
      return true;
    }
    return (
      !!error &&
      typeof error === "object" &&
      "errorCode" in error &&
      (error as { errorCode: string }).errorCode === errorCode
    );
  });
}

describe("assignee approval validation", () => {
  it("requires reason", () => {
    const result = validateAssigneeApprovalReason("");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errors[0]?.code, "ASSIGNEE_REASON_REQUIRED");
    }
  });

  it("rejects reason shorter than minimum", () => {
    const result = validateAssigneeApprovalReason("a".repeat(ASSIGNEE_REASON_MIN_LENGTH - 1));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errors[0]?.code, "ASSIGNEE_REASON_TOO_SHORT");
    }
  });

  it("parses approval payload with display names", () => {
    const payload = parseAssigneeUpdateApprovalPayload({
      action: "set_collaborators",
      requestedCollaboratorIds: [SEED_IDS.staffB],
      currentCollaboratorIds: [],
      addedUserIds: [SEED_IDS.staffB],
      removedUserIds: [],
      reason: "需要共同跟进该客户",
      requestedCollaborators: [{ id: SEED_IDS.staffB, name: "员工 B" }],
    });

    assert.ok(payload);
    assert.equal(payload?.requestedCollaboratorIds[0], SEED_IDS.staffB);
    assert.equal(payload?.reason, "需要共同跟进该客户");
  });
});

describe("owner staff assignee approval request", () => {
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

    await db
      .update(schema.users)
      .set({ isActive: 1, deletedAt: null })
      .where(eq(schema.users.id, SEED_IDS.staffB));

    await clearCollaborators(db, CUSTOMER_ID);
    await clearAssigneeApprovals(db, CUSTOMER_ID);
  });

  after(async () => {
    await db
      .delete(schema.approvals)
      .where(eq(schema.approvals.id, PENDING_APPROVAL_ID));
    await clearAssigneeApprovals(db, CUSTOMER_ID);
    await clearCollaborators(db, CUSTOMER_ID);
    await db
      .update(schema.users)
      .set({ isActive: 1, deletedAt: null })
      .where(eq(schema.users.id, SEED_IDS.staffB));
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  it("owner staff can submit update_customer_assignees approval", async () => {
    const result = await createCustomerAssigneeUpdateApprovalRequest(
      db,
      activeCustomer,
      staffA,
      {
        requestedCollaboratorIds: [SEED_IDS.staffB],
        reason: "需要 Staff B 共同跟进该客户",
      },
    );

    const approval = await getApprovalById(db, result.id);
    assert.ok(approval);
    assert.equal(approval?.requestType, "update_customer_assignees");
    assert.equal(approval?.status, "pending");

    const payload = parseAssigneeUpdateApprovalPayload(
      approval?.payload ? JSON.parse(approval.payload) : null,
    );
    assert.ok(payload);
    assert.deepEqual(payload?.requestedCollaboratorIds, [SEED_IDS.staffB]);
    assert.deepEqual(payload?.addedUserIds, [SEED_IDS.staffB]);

    await clearAssigneeApprovals(db, CUSTOMER_ID);
  });

  it("collaborator staff cannot submit", async () => {
    await applyCollaboratorAssignees(db, {
      customerId: CUSTOMER_ID,
      collaboratorUserIds: [SEED_IDS.staffB],
      assignedBy: SEED_IDS.admin,
    });

    await expectAssigneeApprovalError(
      () =>
        createCustomerAssigneeUpdateApprovalRequest(db, activeCustomer, staffB, {
          requestedCollaboratorIds: [SEED_IDS.staffB],
          reason: "collaborator should not submit assignee request",
        }),
      "ASSIGNEE_APPROVAL_FORBIDDEN",
    );

    await clearCollaborators(db, CUSTOMER_ID);
  });

  it("unrelated staff cannot submit", async () => {
    const unrelated = { id: "11111111-1111-1111-1111-111111111199", role: "staff" } as User;
    await expectAssigneeApprovalError(
      () =>
        createCustomerAssigneeUpdateApprovalRequest(db, activeCustomer, unrelated, {
          requestedCollaboratorIds: [SEED_IDS.staffB],
          reason: "unrelated staff should not submit",
        }),
      "ASSIGNEE_APPROVAL_FORBIDDEN",
    );
  });

  it("admin cannot use owner request API", async () => {
    await expectAssigneeApprovalError(
      () =>
        createCustomerAssigneeUpdateApprovalRequest(db, activeCustomer, admin, {
          requestedCollaboratorIds: [SEED_IDS.staffB],
          reason: "admin should use direct manage API",
        }),
      "ASSIGNEE_APPROVAL_FORBIDDEN",
    );
  });

  it("rejects empty reason", async () => {
    await expectAssigneeApprovalError(
      () =>
        createCustomerAssigneeUpdateApprovalRequest(db, activeCustomer, staffA, {
          requestedCollaboratorIds: [SEED_IDS.staffB],
          reason: "",
        }),
      "VALIDATION_FAILED",
    );
  });

  it("rejects short reason", async () => {
    await expectAssigneeApprovalError(
      () =>
        createCustomerAssigneeUpdateApprovalRequest(db, activeCustomer, staffA, {
          requestedCollaboratorIds: [SEED_IDS.staffB],
          reason: "太短",
        }),
      "VALIDATION_FAILED",
    );
  });

  it("rejects owner as collaborator", async () => {
    await expectAssigneeApprovalError(
      () =>
        createCustomerAssigneeUpdateApprovalRequest(db, activeCustomer, staffA, {
          requestedCollaboratorIds: [SEED_IDS.staffA],
          reason: "不能添加 owner 作为 collaborator",
        }),
      "ASSIGNEE_OWNER_NOT_ALLOWED",
    );
  });

  it("rejects admin as collaborator", async () => {
    await expectAssigneeApprovalError(
      () =>
        createCustomerAssigneeUpdateApprovalRequest(db, activeCustomer, staffA, {
          requestedCollaboratorIds: [SEED_IDS.admin],
          reason: "不能添加 admin 作为 collaborator",
        }),
      "ASSIGNEE_ADMIN_NOT_ALLOWED",
    );
  });

  it("rejects inactive staff", async () => {
    await db
      .update(schema.users)
      .set({ isActive: 0 })
      .where(eq(schema.users.id, SEED_IDS.staffB));

    await expectAssigneeApprovalError(
      () =>
        createCustomerAssigneeUpdateApprovalRequest(db, activeCustomer, staffA, {
          requestedCollaboratorIds: [SEED_IDS.staffB],
          reason: "inactive staff should fail validation",
        }),
      "ASSIGNEE_INACTIVE_USER",
    );

    await db
      .update(schema.users)
      .set({ isActive: 1 })
      .where(eq(schema.users.id, SEED_IDS.staffB));
  });

  it("rejects missing user", async () => {
    await expectAssigneeApprovalError(
      () =>
        createCustomerAssigneeUpdateApprovalRequest(db, activeCustomer, staffA, {
          requestedCollaboratorIds: [MISSING_USER_ID],
          reason: "missing user should fail validation",
        }),
      "ASSIGNEE_USER_NOT_FOUND",
    );
  });

  it("blocks pending on_hold customer", async () => {
    const now = new Date().toISOString();
    await db.insert(schema.approvals).values({
      id: PENDING_APPROVAL_ID,
      requestType: ON_HOLD_CREATE_APPROVAL_TYPE,
      status: "pending",
      customerId: CUSTOMER_ID,
      requestedBy: SEED_IDS.staffA,
      targetUserId: null,
      relatedCustomerIds: null,
      payload: null,
      reason: "付款後需等待安排",
      adminComment: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await assert.rejects(
      () =>
        createCustomerAssigneeUpdateApprovalRequest(db, activeCustomer, staffA, {
          requestedCollaboratorIds: [SEED_IDS.staffB],
          reason: "pending on_hold should block assignee request",
        }),
      PermissionError,
    );

    await db
      .delete(schema.approvals)
      .where(eq(schema.approvals.id, PENDING_APPROVAL_ID));
  });

  it("blocks public_pool customer", async () => {
    const publicPool = makeCustomer({
      id: PUBLIC_POOL_ID,
      status: "public_pool",
      ownerId: null,
    });

    await expectAssigneeApprovalError(
      () =>
        createCustomerAssigneeUpdateApprovalRequest(db, publicPool, staffA, {
          requestedCollaboratorIds: [SEED_IDS.staffB],
          reason: "public pool should be blocked for assignee request",
        }),
      "ASSIGNEE_APPROVAL_FORBIDDEN",
    );
  });

  it("blocks archived customer", async () => {
    const archived = makeCustomer({ id: CUSTOMER_ID, status: "archived" });
    await expectAssigneeApprovalError(
      () =>
        createCustomerAssigneeUpdateApprovalRequest(db, archived, staffA, {
          requestedCollaboratorIds: [SEED_IDS.staffB],
          reason: "archived customer should be blocked",
        }),
      "ASSIGNEE_APPROVAL_FORBIDDEN",
    );
  });

  it("blocks duplicate pending update_customer_assignees", async () => {
    await createCustomerAssigneeUpdateApprovalRequest(db, activeCustomer, staffA, {
      requestedCollaboratorIds: [SEED_IDS.staffB],
      reason: "first pending assignee request should succeed",
    });

    await expectAssigneeApprovalError(
      () =>
        createCustomerAssigneeUpdateApprovalRequest(db, activeCustomer, staffA, {
          requestedCollaboratorIds: [],
          reason: "second pending assignee request should fail",
        }),
      "ASSIGNEE_APPROVAL_ALREADY_PENDING",
    );

    await clearAssigneeApprovals(db, CUSTOMER_ID);
  });
});

describe("assignee approval approve / reject", () => {
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

    await db
      .update(schema.users)
      .set({ isActive: 1, deletedAt: null })
      .where(eq(schema.users.id, SEED_IDS.staffB));

    await clearCollaborators(db, CUSTOMER_ID);
    await clearAssigneeApprovals(db, CUSTOMER_ID);
  });

  after(async () => {
    await clearAssigneeApprovals(db, CUSTOMER_ID);
    await clearCollaborators(db, CUSTOMER_ID);
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await dispose?.();
  });

  async function seedPendingApproval(requestedIds: string[]) {
    await clearAssigneeApprovals(db, CUSTOMER_ID);
    const created = await createCustomerAssigneeUpdateApprovalRequest(
      db,
      activeCustomer,
      staffA,
      {
        requestedCollaboratorIds: requestedIds,
        reason: "需要共同跟进该客户安排",
      },
    );
    return created.id;
  }

  it("approve updates collaborators without touching primary or ownerId", async () => {
    const approvalId = await seedPendingApproval([SEED_IDS.staffB]);
    const ownerBefore = await db
      .select({ ownerId: schema.customers.ownerId, createdBy: schema.customers.createdBy })
      .from(schema.customers)
      .where(eq(schema.customers.id, CUSTOMER_ID))
      .limit(1);

    await approveApprovalRequest(approvalId, admin);

    const rows = await listCustomerAssignees(db, CUSTOMER_ID);
    assert.ok(rows.some((row) => row.role === "primary" && row.userId === SEED_IDS.staffA));
    assert.ok(rows.some((row) => row.role === "collaborator" && row.userId === SEED_IDS.staffB));

    const ownerAfter = await db
      .select({ ownerId: schema.customers.ownerId, createdBy: schema.customers.createdBy })
      .from(schema.customers)
      .where(eq(schema.customers.id, CUSTOMER_ID))
      .limit(1);

    assert.equal(ownerAfter[0]?.ownerId, ownerBefore[0]?.ownerId);
    assert.equal(ownerAfter[0]?.createdBy, ownerBefore[0]?.createdBy);
  });

  it("reject leaves collaborators unchanged", async () => {
    await clearCollaborators(db, CUSTOMER_ID);
    const approvalId = await seedPendingApproval([SEED_IDS.staffB]);

    const now = new Date().toISOString();
    await db
      .update(schema.approvals)
      .set({ status: "rejected", reviewedBy: admin.id, reviewedAt: now, updatedAt: now })
      .where(eq(schema.approvals.id, approvalId));

    const rows = await listCustomerAssignees(db, CUSTOMER_ID);
    assert.equal(rows.filter((row) => row.role === "collaborator").length, 0);
  });

  it("invalid payload does not partially update on approve", async () => {
    const now = new Date().toISOString();
    await db.insert(schema.approvals).values({
      id: ASSIGNEE_APPROVAL_ID,
      requestType: "update_customer_assignees",
      status: "pending",
      customerId: CUSTOMER_ID,
      requestedBy: SEED_IDS.staffA,
      targetUserId: null,
      relatedCustomerIds: null,
      payload: JSON.stringify({ action: "invalid" }),
      reason: "bad payload should not apply",
      adminComment: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await assert.rejects(
      () => approveApprovalRequest(ASSIGNEE_APPROVAL_ID, admin),
    );

    const rows = await listCustomerAssignees(db, CUSTOMER_ID);
    assert.equal(rows.filter((row) => row.role === "collaborator").length, 0);

    await db.delete(schema.approvals).where(eq(schema.approvals.id, ASSIGNEE_APPROVAL_ID));
  });

  it("executeApprovedAssigneeUpdate applies requested collaborators", async () => {
    await clearCollaborators(db, CUSTOMER_ID);
    const payload = {
      action: "set_collaborators",
      currentCollaboratorIds: [],
      requestedCollaboratorIds: [SEED_IDS.staffB],
      addedUserIds: [SEED_IDS.staffB],
      removedUserIds: [],
      reason: "direct execute test",
    };

    await executeApprovedAssigneeUpdate(
      db,
      {
        id: "exec-test",
        payload: JSON.stringify(payload),
        requestedBy: SEED_IDS.staffA,
      },
      activeCustomer,
      admin,
    );

    const rows = await listCustomerAssignees(db, CUSTOMER_ID);
    assert.ok(rows.some((row) => row.role === "collaborator" && row.userId === SEED_IDS.staffB));
  });
});
