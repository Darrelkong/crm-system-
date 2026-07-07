import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { CustomerWithScores } from "@/lib/customers/scoring/service";
import { formatCustomerForUser } from "@/lib/permissions/customers";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import {
  formatAssigneeNamesForList,
  joinAssigneeNames,
  resolveAssigneeStaffForList,
} from "./assignee-display";
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

const listLabels = {
  publicPool: "公共池",
  unknownStaff: "未知員工",
};

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

describe("formatAssigneeNamesForList", () => {
  it("shows one assignee name", () => {
    const result = formatAssigneeNamesForList(["員工 A"]);
    assert.equal(result.display, "員工 A");
    assert.equal(result.title, undefined);
  });

  it("shows two assignee names joined with 、", () => {
    const result = formatAssigneeNamesForList(["員工 A", "員工 B"]);
    assert.equal(result.display, "員工 A、員工 B");
    assert.equal(result.title, undefined);
  });

  it("shows first two names plus overflow for three or more assignees", () => {
    const result = formatAssigneeNamesForList(["員工 A", "員工 B", "員工 C"]);
    assert.equal(result.display, "員工 A、員工 B +1");
    assert.equal(result.title, "員工 A、員工 B、員工 C");
  });

  it("uses comma separator for English locale", () => {
    const result = formatAssigneeNamesForList(
      ["Staff A", "Staff B", "Staff C"],
      "en",
    );
    assert.equal(result.display, "Staff A, Staff B +1");
    assert.equal(result.title, "Staff A, Staff B, Staff C");
  });
});

describe("resolveAssigneeStaffForList", () => {
  it("falls back to ownerName when assignees are empty", () => {
    const result = resolveAssigneeStaffForList(
      {
        status: "active",
        ownerId: "owner-1",
        ownerName: "原負責人",
        assigneeNames: [],
      },
      listLabels,
    );
    assert.equal(result.display, "原負責人");
  });

  it("prefers assignee names over ownerName", () => {
    const result = resolveAssigneeStaffForList(
      {
        status: "active",
        ownerId: "owner-1",
        ownerName: "原負責人",
        assigneeNames: ["員工 A", "員工 B"],
      },
      listLabels,
    );
    assert.equal(result.display, "員工 A、員工 B");
  });

  it("shows public pool label for public pool customers", () => {
    const result = resolveAssigneeStaffForList(
      {
        status: "public_pool",
        ownerId: null,
        ownerName: null,
        assigneeNames: [],
      },
      listLabels,
    );
    assert.equal(result.display, "公共池");
  });
});

describe("joinAssigneeNames", () => {
  it("joins all assignee names for detail display", () => {
    assert.equal(
      joinAssigneeNames(["員工 A", "員工 B", "員工 C"]),
      "員工 A、員工 B、員工 C",
    );
  });
});

describe("toCustomerListRow pin fields", () => {
  it("includes isPinned and pinnedAt for pinned customers", () => {
    const customer = makeCustomer({
      id: "c1",
      customerName: "Pinned client",
      isPinned: 1,
      pinnedAt: "2026-06-28T09:00:00.000Z",
    });
    const view = makeScoredView(adminUser, customer);
    const row = toCustomerListRow(view, "Staff A", ["Staff A"]);

    assert.equal(row.isPinned, true);
    assert.equal(row.pinnedAt, "2026-06-28T09:00:00.000Z");
    assert.deepEqual(row.assigneeNames, ["Staff A"]);
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

  it("includes lifecycleStatus for completed customers", () => {
    const customer = makeCustomer({
      id: "c3",
      customerName: "Completed client",
      salesStage: "paid",
      lifecycleStatus: "completed",
    });
    const view = makeScoredView(adminUser, customer);
    const row = toCustomerListRow(view, "Staff A");

    assert.equal(row.lifecycleStatus, "completed");
    assert.equal(row.salesStage, "paid");
  });
});

describe("D-2b list filtering unchanged", () => {
  it("list queries still exclude pending on_hold create approvals", () => {
    const src = readFileSync("src/lib/customers/queries.ts", "utf8");
    assert.match(src, /excludePendingOnHoldCreateApprovalWhere/);
  });
});
