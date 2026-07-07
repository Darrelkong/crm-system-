import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPaidCustomerApprovalPayload,
  validatePaidCustomerFormClient,
} from "./paid-customer-payload";

describe("paid customer approval payload", () => {
  it("maps paid_customer fields to serviceItems / paidAmount / paidAt / remarks", () => {
    const payload = buildPaidCustomerApprovalPayload({
      serviceItems: "  顾问服务  ",
      paidAmount: " 5000 ",
      paidAt: "2026-07-01",
      remarks: "  首笔付款  ",
    });

    assert.deepEqual(payload, {
      serviceItems: "顾问服务",
      paidAmount: "5000",
      paidAt: "2026-07-01",
      remarks: "首笔付款",
    });
    assert.equal("dealAmount" in payload, false);
    assert.equal("signingDate" in payload, false);
    assert.equal("dealNotes" in payload, false);
  });

  it("omits empty remarks from payload", () => {
    const payload = buildPaidCustomerApprovalPayload({
      serviceItems: "顾问服务",
      paidAmount: "5000",
      paidAt: "2026-07-01",
      remarks: "   ",
    });

    assert.deepEqual(payload, {
      serviceItems: "顾问服务",
      paidAmount: "5000",
      paidAt: "2026-07-01",
    });
    assert.equal("remarks" in payload, false);
  });

  it("rejects missing serviceItems", () => {
    const result = validatePaidCustomerFormClient({
      serviceItems: " ",
      paidAmount: "5000",
      paidAt: "2026-07-01",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.field === "serviceItems"));
    }
  });

  it("rejects missing paidAmount", () => {
    const result = validatePaidCustomerFormClient({
      serviceItems: "顾问服务",
      paidAmount: "",
      paidAt: "2026-07-01",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.field === "paidAmount"));
    }
  });

  it("rejects zero or negative paidAmount", () => {
    for (const paidAmount of ["0", "-1"]) {
      const result = validatePaidCustomerFormClient({
        serviceItems: "顾问服务",
        paidAmount,
        paidAt: "2026-07-01",
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.errors.some((e) => e.field === "paidAmount"));
      }
    }
  });

  it("rejects missing paidAt", () => {
    const result = validatePaidCustomerFormClient({
      serviceItems: "顾问服务",
      paidAmount: "5000",
      paidAt: "",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.field === "paidAt"));
    }
  });

  it("accepts valid paid_customer form input", () => {
    const result = validatePaidCustomerFormClient({
      serviceItems: "顾问服务",
      paidAmount: "5000",
      paidAt: "2026-07-01",
      remarks: "备注",
    });
    assert.equal(result.ok, true);
  });
});
