import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SEED_IDS } from "@/lib/constants/seed-ids";
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

describe("approval validation paid_customer", () => {
  it("accepts paid_customer as a valid request type", () => {
    assert.equal(isApprovalRequestType("paid_customer"), true);
  });

  it("rejects paid_customer with missing serviceItems", () => {
    const result = validateApprovalRequestInput({
      requestType: "paid_customer",
      reason: "客户已完成付款",
      payload: { paidAmount: "5000", paidAt: "2026-07-01" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const err = result.fieldErrors.find((e) => e.field === "serviceItems");
      assert.ok(err, "should have serviceItems error");
    }
  });

  it("rejects paid_customer with empty serviceItems", () => {
    const result = validateApprovalRequestInput({
      requestType: "paid_customer",
      reason: "客户已完成付款",
      payload: { serviceItems: "   ", paidAmount: "5000", paidAt: "2026-07-01" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const err = result.fieldErrors.find((e) => e.field === "serviceItems");
      assert.ok(err, "should have serviceItems error");
    }
  });

  it("rejects paid_customer with missing paidAmount", () => {
    const result = validateApprovalRequestInput({
      requestType: "paid_customer",
      reason: "客户已完成付款",
      payload: { serviceItems: "顾问服务", paidAt: "2026-07-01" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const err = result.fieldErrors.find((e) => e.field === "paidAmount");
      assert.ok(err, "should have paidAmount error");
    }
  });

  it("rejects paid_customer with paidAmount = 0", () => {
    const result = validateApprovalRequestInput({
      requestType: "paid_customer",
      reason: "客户已完成付款",
      payload: { serviceItems: "顾问服务", paidAmount: "0", paidAt: "2026-07-01" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const err = result.fieldErrors.find((e) => e.field === "paidAmount");
      assert.ok(err, "should have paidAmount > 0 error");
    }
  });

  it("rejects paid_customer with negative paidAmount", () => {
    const result = validateApprovalRequestInput({
      requestType: "paid_customer",
      reason: "客户已完成付款",
      payload: { serviceItems: "顾问服务", paidAmount: "-100", paidAt: "2026-07-01" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const err = result.fieldErrors.find((e) => e.field === "paidAmount");
      assert.ok(err, "should have paidAmount > 0 error");
    }
  });

  it("rejects paid_customer with non-numeric paidAmount", () => {
    const result = validateApprovalRequestInput({
      requestType: "paid_customer",
      reason: "客户已完成付款",
      payload: { serviceItems: "顾问服务", paidAmount: "abc", paidAt: "2026-07-01" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const err = result.fieldErrors.find((e) => e.field === "paidAmount");
      assert.ok(err, "should have paidAmount error for non-numeric");
    }
  });

  it("rejects paid_customer with missing paidAt", () => {
    const result = validateApprovalRequestInput({
      requestType: "paid_customer",
      reason: "客户已完成付款",
      payload: { serviceItems: "顾问服务", paidAmount: "5000" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const err = result.fieldErrors.find((e) => e.field === "paidAt");
      assert.ok(err, "should have paidAt error");
    }
  });

  it("accepts valid paid_customer payload", () => {
    const result = validateApprovalRequestInput({
      requestType: "paid_customer",
      reason: "客户已完成付款",
      payload: { serviceItems: "顾问服务", paidAmount: "5000", paidAt: "2026-07-01" },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.requestType, "paid_customer");
      assert.deepEqual(result.value.payload, {
        serviceItems: "顾问服务",
        paidAmount: "5000",
        paidAt: "2026-07-01",
      });
    }
  });

  it("accepts valid paid_customer payload with optional remarks", () => {
    const result = validateApprovalRequestInput({
      requestType: "paid_customer",
      reason: "客户已完成付款",
      payload: {
        serviceItems: "顾问服务",
        paidAmount: "5000",
        paidAt: "2026-07-01",
        remarks: "备注内容",
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.requestType, "paid_customer");
    }
  });
});

describe("approval validation merge_customers disabled", () => {
  it("rejects merge_customers create with MERGE_CUSTOMERS_DISABLED", () => {
    const result = validateApprovalRequestInput({
      requestType: "merge_customers",
      reason: "疑似重复客户",
      relatedCustomerIds: [SEED_IDS.customerStaffB],
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      const requestTypeError = result.fieldErrors.find((e) => e.field === "requestType");
      assert.ok(requestTypeError);
      assert.equal(requestTypeError?.code, "MERGE_CUSTOMERS_DISABLED");
    }
  });

  it("still accepts delete_customer requests", () => {
    const result = validateApprovalRequestInput({
      requestType: "delete_customer",
      reason: "客户已流失",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.requestType, "delete_customer");
    }
  });
});
