import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerWithScores } from "@/lib/customers/scoring/service";
import { formatCustomerForUser } from "@/lib/permissions/customers";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { toCustomerListRow } from "./list-rows";

function makeCustomer(
  overrides: Partial<Customer> & Pick<Customer, "id" | "customerName">,
): Customer {
  const now = "2026-06-28T12:00:00.000Z";
  return {
    customerCode: "EF-001",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000000",
    wechatId: "wx",
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: "測試項目",
    notes: "備註備註備註備註備註",
    salesStage: "new_lead",
    status: "active",
    ownerId: "11111111-1111-1111-1111-111111111102",
    releaserUserId: null,
    isPinned: 0,
    pinnedAt: null,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    createdBy: "11111111-1111-1111-1111-111111111102",
    updatedBy: "11111111-1111-1111-1111-111111111102",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    ...overrides,
  } as Customer;
}

const staffUser = {
  id: "11111111-1111-1111-1111-111111111102",
  role: "staff",
} as User;

const adminUser = {
  id: "11111111-1111-1111-1111-111111111101",
  role: "admin",
} as User;

function makeScoredView(
  user: User,
  customer: Customer,
): CustomerWithScores {
  const view = formatCustomerForUser(user, customer);
  return {
    ...view,
    heatLevel: "high",
    completenessScore: 80,
  };
}

describe("toCustomerListRow pin fields", () => {
  it("includes isPinned and pinnedAt for pinned customers", () => {
    const customer = makeCustomer({
      id: "c1",
      customerName: "Pinned client",
      isPinned: 1,
      pinnedAt: "2026-06-28T09:00:00.000Z",
    });
    const view = makeScoredView(adminUser, customer);
    const row = toCustomerListRow(view, "Staff A");

    assert.equal(row.isPinned, true);
    assert.equal(row.pinnedAt, "2026-06-28T09:00:00.000Z");
  });

  it("includes isPinned for staff without exposing customerCode", () => {
    const customer = makeCustomer({
      id: "c2",
      customerName: "Staff pinned client",
      isPinned: 1,
      pinnedAt: "2026-06-28T09:00:00.000Z",
    });
    const view = makeScoredView(staffUser, customer);
    const row = toCustomerListRow(view, "Staff A");

    assert.equal(row.isPinned, true);
    assert.equal(row.customerCode, undefined);
    assert.equal("customerCode" in view, false);
  });
});
