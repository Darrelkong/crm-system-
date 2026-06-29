import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  canAddFollowUp,
  canEditCustomer,
  canReleaseToPool,
  formatCustomerForUser,
  getCustomerAccessLevel,
} from "./customers";
import { canSubmitApprovalRequest } from "./approvals";

const staffA = {
  id: SEED_IDS.staffA,
  role: "staff",
} as User;

const staffB = {
  id: SEED_IDS.staffB,
  role: "staff",
} as User;

const staffC = {
  id: "11111111-1111-1111-1111-111111111199",
  role: "staff",
} as User;

const admin = {
  id: SEED_IDS.admin,
  role: "admin",
} as User;

function makeActiveCustomer(
  overrides: Partial<Customer> & Pick<Customer, "id" | "customerName">,
): Customer {
  const now = "2026-06-28T12:00:00.000Z";
  return {
    customerCode: "EF-100",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000001",
    wechatId: "wx",
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: "項目",
    notes: "備註",
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

describe("getCustomerAccessLevel assignee support", () => {
  const customer = makeActiveCustomer({
    id: "customer-x",
    customerName: "客戶 X",
  });

  it("gives staff B full access when isAssignee is true", () => {
    assert.equal(
      getCustomerAccessLevel(staffB, customer, { isAssignee: true }),
      "full",
    );
  });

  it("denies staff C without assignee flag", () => {
    assert.equal(getCustomerAccessLevel(staffC, customer), "denied");
  });

  it("gives archived_basic to assignee on archived customer", () => {
    const archived = makeActiveCustomer({
      id: "customer-archived",
      customerName: "歸檔客戶",
      status: "archived",
    });
    assert.equal(
      getCustomerAccessLevel(staffB, archived, { isAssignee: true }),
      "archived_basic",
    );
  });

  it("keeps public pool masked even for assignee flag", () => {
    const publicPool = makeActiveCustomer({
      id: "customer-pool",
      customerName: "公共池客戶",
      status: "public_pool",
      ownerId: null,
    });
    assert.equal(
      getCustomerAccessLevel(staffB, publicPool, { isAssignee: true }),
      "masked",
    );
  });
});

describe("assignee operational permissions", () => {
  const customer = makeActiveCustomer({
    id: "customer-x",
    customerName: "客戶 X",
  });
  const assigneeOptions = { isAssignee: true };

  it("allows assignee to add follow-up", () => {
    assert.equal(canAddFollowUp(staffB, customer, assigneeOptions), true);
  });

  it("denies non-assignee follow-up", () => {
    assert.equal(canAddFollowUp(staffC, customer), false);
  });

  it("denies assignee edit / release / approval", () => {
    assert.equal(canEditCustomer(staffB, customer), false);
    assert.equal(canReleaseToPool(staffB, customer), false);
    assert.equal(canSubmitApprovalRequest(staffB, customer), false);
  });

  it("allows owner edit / follow-up", () => {
    assert.equal(canEditCustomer(staffA, customer), true);
    assert.equal(canAddFollowUp(staffA, customer), true);
  });
});

describe("formatCustomerForUser assignee EF visibility", () => {
  it("hides customerCode for assignee staff", () => {
    const customer = makeActiveCustomer({
      id: "customer-x",
      customerName: "客戶 X",
    });
    const view = formatCustomerForUser(staffB, customer, { isAssignee: true });
    assert.equal(view.accessLevel, "full");
    assert.equal("customerCode" in view, false);
  });

  it("shows customerCode for admin", () => {
    const customer = makeActiveCustomer({
      id: "customer-x",
      customerName: "客戶 X",
    });
    const view = formatCustomerForUser(admin, customer);
    assert.equal(view.customerCode, "EF-100");
  });
});
