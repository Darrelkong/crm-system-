import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUDIT_ACTION_LABELS,
  CUSTOMER_TIMELINE_AUDIT_ACTIONS,
} from "./constants";

describe("CUSTOMER_TIMELINE_AUDIT_ACTIONS (CUSTOMER-FLOW-SAFETY-1)", () => {
  it("includes customer.paid.approved for paid approval timeline display", () => {
    assert.equal(
      CUSTOMER_TIMELINE_AUDIT_ACTIONS.has("customer.paid.approved"),
      true,
    );
  });

  it("keeps customer.closed_won.approved in the timeline allowlist", () => {
    assert.equal(
      CUSTOMER_TIMELINE_AUDIT_ACTIONS.has("customer.closed_won.approved"),
      true,
    );
  });

  it("does not remove other customer timeline audit events", () => {
    const expected = [
      "customer.created",
      "customer.updated",
      "customer.imported",
      "customer.released_to_pool",
      "customer.claimed_from_pool",
      "customer.auto_reclaimed_to_pool",
      "customer.transferred",
      "customer.transferred.staff_deleted",
      "customer.on_hold_create.approved",
      "customer.on_hold_create.rejected",
      "customer.deleted.soft",
      "customer.auto_reclaim_warning.day_6",
      "customer.auto_reclaim_warning.day_7",
    ];
    for (const action of expected) {
      assert.equal(CUSTOMER_TIMELINE_AUDIT_ACTIONS.has(action), true);
    }
  });

  it("provides a label for customer.paid.approved", () => {
    assert.equal(
      AUDIT_ACTION_LABELS["customer.paid.approved"],
      "客户已付款审批通过",
    );
  });

  it("includes customer.lifecycle.completed for lifecycle complete timeline display", () => {
    assert.equal(
      CUSTOMER_TIMELINE_AUDIT_ACTIONS.has("customer.lifecycle.completed"),
      true,
    );
    assert.equal(
      AUDIT_ACTION_LABELS["customer.lifecycle.completed"],
      "客户已标记为已完结",
    );
  });
});
