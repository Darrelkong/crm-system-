import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  PermissionError,
  assertCanAddFollowUp,
} from "@/lib/permissions/customers";

const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;
const staffB = { id: SEED_IDS.staffB, role: "staff" } as User;
const admin = { id: SEED_IDS.admin, role: "admin" } as User;

function makeCustomer(
  overrides: Partial<Customer> & Pick<Customer, "id" | "customerName">,
): Customer {
  const now = "2026-06-28T12:00:00.000Z";
  return {
    customerCode: "EF-100",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000001",
    wechatId: "wx-secret",
    email: "secret@example.com",
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

describe("follow-up organize permission gate (assertCanAddFollowUp)", () => {
  const owned = makeCustomer({ id: "c-owned", customerName: "Owned" });

  it("allows admin", () => {
    assert.doesNotThrow(() => assertCanAddFollowUp(admin, owned));
  });

  it("allows owner staff", () => {
    assert.doesNotThrow(() => assertCanAddFollowUp(staffA, owned));
  });

  it("allows assignee collaborator", () => {
    assert.doesNotThrow(() =>
      assertCanAddFollowUp(staffB, owned, { isAssignee: true }),
    );
  });

  it("rejects unrelated staff", () => {
    assert.throws(
      () => assertCanAddFollowUp(staffB, owned),
      (err: unknown) =>
        err instanceof PermissionError && err.status === 403,
    );
  });

  it("rejects public pool masked customers for staff", () => {
    const pool = makeCustomer({
      id: "c-pool",
      customerName: "Pool",
      status: "public_pool",
      ownerId: null,
    });
    assert.throws(
      () => assertCanAddFollowUp(staffA, pool),
      (err: unknown) =>
        err instanceof PermissionError && err.status === 403,
    );
  });
});
