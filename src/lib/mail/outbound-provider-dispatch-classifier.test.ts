import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAutomaticDispatchEligibleSendStatus,
  isTerminalSendOperationStatus,
  OUTBOUND_DISPATCH_UNCERTAIN_ERROR_CODE,
  classifyThrownOutboundProviderDispatchError,
} from "@/lib/mail/outbound-provider-dispatch-classifier";

describe("outbound provider dispatch classifier", () => {
  it("dispatch_uncertain is terminal and not auto-dispatch eligible", () => {
    assert.equal(isTerminalSendOperationStatus("dispatch_uncertain"), true);
    assert.equal(isAutomaticDispatchEligibleSendStatus("dispatch_uncertain"), false);
  });

  it("pending is auto-dispatch eligible", () => {
    assert.equal(isAutomaticDispatchEligibleSendStatus("pending"), true);
    assert.equal(isTerminalSendOperationStatus("pending"), false);
  });

  it("classifies thrown errors as outbound_dispatch_uncertain", () => {
    const result = classifyThrownOutboundProviderDispatchError(
      new Error("network dropped"),
    );
    assert.equal(result.errorCode, OUTBOUND_DISPATCH_UNCERTAIN_ERROR_CODE);
    assert.equal(result.errorMessage, "network dropped");
  });
});

describe("approved outbound queue dispatch_uncertain mapping", () => {
  it("maps dispatch_uncertain to safe display phase", async () => {
    const { resolveApprovedOutboundDisplayPhase, resolveOutboundQueuePhase } =
      await import("@/lib/mail/client/approved-outbound-queue");

    const approval = {
      id: "approval-1",
      revisionChainId: "rev-chain-1",
      status: "approved" as const,
      priority: "normal" as const,
      workflowVersion: 1,
      currentRevisionId: "rev-1",
      currentContentHash: "hash",
      currentHashVersion: 1,
      approvedRevisionId: "rev-1",
      approvedContentHash: "hash",
      approvedHashVersion: 1,
      requestedByUserId: "user-1",
      requestedAt: "2026-01-01T00:00:00.000Z",
      resolvedByUserId: "user-2",
      resolvedAt: "2026-01-01T00:00:01.000Z",
    };
    const send = {
      id: "send-1",
      outboundRevisionId: "rev-1",
      revisionChainId: "rev-1",
      contentHash: "hash",
      hashVersion: 1,
      revisionKind: "staff_submit" as const,
      authorizationMode: "staff_approved" as const,
      approvalId: "approval-1",
      idempotencyKey: "key",
      status: "dispatch_uncertain" as const,
      orchestrationVersion: 2,
      initiatedByUserId: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      nextAttemptAt: null,
    };

    assert.equal(resolveOutboundQueuePhase(send), "dispatch_uncertain");
    assert.equal(
      resolveApprovedOutboundDisplayPhase({ approval, send }),
      "dispatch_uncertain",
    );
  });
});
