import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isApprovalRequestType,
  validateApprovalRequestInput,
} from "./validation";

describe("approval validation create_on_hold_customer", () => {
  it("accepts create_on_hold_customer as a valid request type", () => {
    assert.equal(isApprovalRequestType("create_on_hold_customer"), true);
  });

  it("validates create_on_hold_customer with reason only", () => {
    const result = validateApprovalRequestInput({
      requestType: "create_on_hold_customer",
      reason: "客户暂时搁置，需管理员确认",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.requestType, "create_on_hold_customer");
      assert.equal(result.value.reason, "客户暂时搁置，需管理员确认");
    }
  });
});

describe("approval validation update_customer_assignees", () => {
  it("accepts update_customer_assignees as a valid request type", () => {
    assert.equal(isApprovalRequestType("update_customer_assignees"), true);
  });

  it("validates update_customer_assignees with reason only", () => {
    const result = validateApprovalRequestInput({
      requestType: "update_customer_assignees",
      reason: "后续由 B 和 C 共同跟进",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.requestType, "update_customer_assignees");
      assert.equal(result.value.reason, "后续由 B 和 C 共同跟进");
    }
  });
});
