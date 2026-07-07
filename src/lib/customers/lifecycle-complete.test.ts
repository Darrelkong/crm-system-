import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  CUSTOMER_LIFECYCLE_COMPLETED,
  CUSTOMER_LIFECYCLE_COMPLETED_AUDIT_ACTION,
  LifecycleCompleteError,
  assertCanCompleteCustomerLifecycle,
} from "./lifecycle-complete";
import {
  AUDIT_ACTION_LABELS,
  CUSTOMER_TIMELINE_AUDIT_ACTIONS,
} from "./timeline/constants";

const admin = { id: SEED_IDS.admin, role: "admin" } as User;
const staffA = { id: SEED_IDS.staffA, role: "staff" } as User;

function makeCustomer(
  overrides: Partial<Customer> & Pick<Customer, "id">,
): Customer {
  const now = "2026-07-08T12:00:00.000Z";
  return {
    customerCode: "EF-LC-301",
    customerName: "生命周期测试客户",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800000301",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    notes: null,
    salesStage: "paid",
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
    createdBy: SEED_IDS.staffA,
    updatedBy: SEED_IDS.staffA,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    collaborativeDissolvedAt: null,
    lifecycleStatus: null,
    lifecycleCompletedAt: null,
    lifecycleCompletedBy: null,
    lifecycleCompletionNotes: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Customer;
}

describe("assertCanCompleteCustomerLifecycle", () => {
  it("rejects staff", () => {
    const customer = makeCustomer({ id: "33333333-3333-3333-3333-333333333301" });
    assert.throws(
      () => assertCanCompleteCustomerLifecycle(customer, staffA),
      (error: unknown) => {
        assert.ok(error instanceof LifecycleCompleteError);
        assert.equal(error.code, "ADMIN_REQUIRED");
        assert.equal(error.status, 403);
        return true;
      },
    );
  });

  it("rejects non-paid customers", () => {
    const customer = makeCustomer({
      id: "33333333-3333-3333-3333-333333333301",
      salesStage: "negotiation",
    });
    assert.throws(
      () => assertCanCompleteCustomerLifecycle(customer, admin),
      (error: unknown) => {
        assert.ok(error instanceof LifecycleCompleteError);
        assert.equal(error.code, "CUSTOMER_NOT_PAID");
        return true;
      },
    );
  });

  it("rejects already completed customers", () => {
    const customer = makeCustomer({
      id: "33333333-3333-3333-3333-333333333301",
      lifecycleStatus: CUSTOMER_LIFECYCLE_COMPLETED,
    });
    assert.throws(
      () => assertCanCompleteCustomerLifecycle(customer, admin),
      (error: unknown) => {
        assert.ok(error instanceof LifecycleCompleteError);
        assert.equal(error.code, "ALREADY_COMPLETED");
        assert.equal(error.status, 409);
        return true;
      },
    );
  });

  it("rejects archived customers", () => {
    const customer = makeCustomer({
      id: "33333333-3333-3333-3333-333333333301",
      status: "archived",
      deletedAt: "2026-07-08T12:00:00.000Z",
    });
    assert.throws(
      () => assertCanCompleteCustomerLifecycle(customer, admin),
      (error: unknown) => {
        assert.ok(error instanceof LifecycleCompleteError);
        assert.equal(error.code, "CUSTOMER_ARCHIVED");
        return true;
      },
    );
  });

  it("rejects public pool customers", () => {
    const customer = makeCustomer({
      id: "33333333-3333-3333-3333-333333333301",
      status: "public_pool",
    });
    assert.throws(
      () => assertCanCompleteCustomerLifecycle(customer, admin),
      (error: unknown) => {
        assert.ok(error instanceof LifecycleCompleteError);
        assert.equal(error.code, "CUSTOMER_IN_PUBLIC_POOL");
        return true;
      },
    );
  });
});

describe("CUSTOMER_TIMELINE_AUDIT_ACTIONS (CUSTOMER-FLOW-3A)", () => {
  it("includes customer.lifecycle.completed", () => {
    assert.equal(
      CUSTOMER_TIMELINE_AUDIT_ACTIONS.has(
        CUSTOMER_LIFECYCLE_COMPLETED_AUDIT_ACTION,
      ),
      true,
    );
  });

  it("keeps customer.paid.approved in timeline allowlist", () => {
    assert.equal(
      CUSTOMER_TIMELINE_AUDIT_ACTIONS.has("customer.paid.approved"),
      true,
    );
  });

  it("provides a label for customer.lifecycle.completed", () => {
    assert.equal(
      AUDIT_ACTION_LABELS[CUSTOMER_LIFECYCLE_COMPLETED_AUDIT_ACTION],
      "客户已标记为已完结",
    );
  });
});
