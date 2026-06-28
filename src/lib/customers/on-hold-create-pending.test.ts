import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOnHoldCreateApprovalPayload,
  isStaffOnHoldCreatePending,
  ON_HOLD_REASON_MIN_LENGTH,
  resolvePersistedSalesStageForCreate,
  validateOnHoldReason,
} from "./on-hold-create-pending";

describe("on-hold create pending helpers", () => {
  it("staff on_hold requires pending approval", () => {
    assert.equal(isStaffOnHoldCreatePending("staff", "on_hold"), true);
  });

  it("admin on_hold does not require pending approval", () => {
    assert.equal(isStaffOnHoldCreatePending("admin", "on_hold"), false);
  });

  it("staff normal stage does not require pending approval", () => {
    assert.equal(isStaffOnHoldCreatePending("staff", "new_lead"), false);
  });

  it("persists new_lead for staff on_hold create", () => {
    assert.equal(
      resolvePersistedSalesStageForCreate("staff", "on_hold"),
      "new_lead",
    );
  });

  it("persists requested stage for admin on_hold create", () => {
    assert.equal(
      resolvePersistedSalesStageForCreate("admin", "on_hold"),
      "on_hold",
    );
  });

  it("persists requested stage for staff normal create", () => {
    assert.equal(
      resolvePersistedSalesStageForCreate("staff", "contacted"),
      "contacted",
    );
  });

  it("builds approval payload with onHoldReason", () => {
    const payload = buildOnHoldCreateApprovalPayload({
      requestedSalesStage: "on_hold",
      onHoldReason: "付款後流程較長需等待安排",
      customerName: "测试客户",
      customerType: "individual",
      phoneCountryCode: "+86",
      phone: "13800138000",
      source: "referral",
      notes: "首次溝通備註內容",
    });

    assert.equal(payload.requestedSalesStage, "on_hold");
    assert.equal(payload.targetSalesStage, "on_hold");
    assert.equal(payload.onHoldReason, "付款後流程較長需等待安排");
    assert.equal(payload.customerName, "测试客户");
    assert.equal(payload.notes, "首次溝通備註內容");
  });

  it("rejects missing onHoldReason", () => {
    const result = validateOnHoldReason("");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorCode, "ON_HOLD_REASON_REQUIRED");
    }
  });

  it("rejects onHoldReason shorter than minimum", () => {
    const result = validateOnHoldReason("a".repeat(ON_HOLD_REASON_MIN_LENGTH - 1));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorCode, "ON_HOLD_REASON_TOO_SHORT");
    }
  });

  it("accepts valid onHoldReason", () => {
    const result = validateOnHoldReason("  付款後需等待安排  ");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value, "付款後需等待安排");
    }
  });
});
