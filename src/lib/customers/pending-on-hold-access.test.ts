import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOnHoldCreateApprovedAuditMetadata,
  buildOnHoldCreateApprovedCustomerUpdate,
  buildOnHoldCreateRejectedAuditMetadata,
  resolveOnHoldReasonFromApproval,
} from "./pending-on-hold-access";

describe("pending on-hold access helpers", () => {
  it("builds approved customer update with on_hold and pin fields", () => {
    const now = "2026-06-24T10:00:00.000Z";
    const update = buildOnHoldCreateApprovedCustomerUpdate(now);

    assert.equal(update.salesStage, "on_hold");
    assert.equal(update.isPinned, 1);
    assert.equal(update.pinnedAt, now);
    assert.equal(update.updatedAt, now);
  });

  it("prefers approval.reason for on-hold reason", () => {
    const reason = resolveOnHoldReasonFromApproval({
      reason: "付款後流程較長需等待安排",
      payload: JSON.stringify({ onHoldReason: "payload reason" }),
    });

    assert.equal(reason, "付款後流程較長需等待安排");
  });

  it("falls back to payload onHoldReason when approval.reason is empty", () => {
    const reason = resolveOnHoldReasonFromApproval({
      reason: "   ",
      payload: JSON.stringify({ onHoldReason: "payload reason text" }),
    });

    assert.equal(reason, "payload reason text");
  });

  it("builds approved audit metadata with requester and reason", () => {
    const metadata = buildOnHoldCreateApprovedAuditMetadata({
      approvalId: "approval-1",
      customerName: "测试客户",
      requestedBy: "staff-1",
      requestedByName: "员工 A",
      onHoldReason: "付款後需等待安排",
    });

    assert.equal(metadata.approvalId, "approval-1");
    assert.equal(metadata.requestedByName, "员工 A");
    assert.equal(metadata.onHoldReason, "付款後需等待安排");
  });

  it("builds rejected audit metadata with admin comment", () => {
    const metadata = buildOnHoldCreateRejectedAuditMetadata({
      approvalId: "approval-2",
      customerName: "测试客户",
      requestedBy: "staff-1",
      adminComment: "资料不完整",
    });

    assert.equal(metadata.adminComment, "资料不完整");
  });
});
