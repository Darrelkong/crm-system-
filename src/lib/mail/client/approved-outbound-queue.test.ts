import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ApprovalApiItem } from "@/lib/mail/client/approval-workflow-management";
import {
  assertSendOperationSnapshotIntegrity,
  buildApprovedSendIdempotencyKey,
  canReadApprovalSendOperation,
  resolveApprovedOutboundDisplayPhase,
  resolveOutboundQueuePhase,
  resolveSendDeliveryLifecycleLabelKey,
  shouldLiveRefreshApprovedDetail,
  type SendOperationApiItem,
} from "@/lib/mail/client/approved-outbound-queue";

function approval(
  overrides: Partial<ApprovalApiItem> = {},
): ApprovalApiItem {
  return {
    id: "approval-1",
    revisionChainId: "chain-1",
    status: "approved",
    priority: "normal",
    workflowVersion: 2,
    currentRevisionId: "revision-1",
    currentContentHash: "hash-1",
    currentHashVersion: 1,
    approvedRevisionId: "revision-1",
    approvedContentHash: "hash-1",
    approvedHashVersion: 1,
    requestedByUserId: "author-1",
    requestedAt: "2026-08-22T08:00:00.000Z",
    resolvedByUserId: "reviewer-1",
    resolvedAt: "2026-08-22T09:00:00.000Z",
    ...overrides,
  };
}

function sendOperation(
  overrides: Partial<SendOperationApiItem> = {},
): SendOperationApiItem {
  return {
    id: "send-1",
    outboundRevisionId: "revision-1",
    revisionChainId: "chain-1",
    contentHash: "hash-1",
    hashVersion: 1,
    revisionKind: "staff_submit",
    authorizationMode: "staff_approved",
    approvalId: "approval-1",
    idempotencyKey: "mail:approval:approval-1:send",
    status: "pending",
    orchestrationVersion: 1,
    initiatedByUserId: "reviewer-1",
    createdAt: "2026-08-22T09:00:00.000Z",
    completedAt: null,
    nextAttemptAt: null,
    rfcIdentity: {
      id: "rfc-1",
      rfcMessageId: "<abc@echfronthk.com>",
      createdAt: "2026-08-22T09:00:00.000Z",
    },
    ...overrides,
  };
}

describe("approved outbound queue", () => {
  it("maps admin_direct send without approval to outbound display phases", () => {
    assert.equal(
      resolveApprovedOutboundDisplayPhase({
        approval: null,
        send: sendOperation({
          authorizationMode: "admin_direct",
          approvalId: null,
          revisionKind: "admin_direct",
        }),
      }),
      "waiting_to_send",
    );
  });

  it("maps pending send operations to queued and ready_for_transport phases", () => {
    assert.equal(resolveOutboundQueuePhase(null), "none");
    assert.equal(
      resolveOutboundQueuePhase(sendOperation({ rfcIdentity: undefined })),
      "queued",
    );
    assert.equal(resolveOutboundQueuePhase(sendOperation()), "ready_for_transport");
    assert.equal(
      resolveApprovedOutboundDisplayPhase({
        approval: approval(),
        send: sendOperation(),
      }),
      "waiting_to_send",
    );
  });

  it("maps delivery lifecycle phases into compose display states", () => {
    assert.equal(
      resolveApprovedOutboundDisplayPhase({
        approval: approval(),
        send: sendOperation({ status: "accepted" }),
        delivery: { lifecyclePhase: "delivered" },
      }),
      "delivered",
    );
    assert.equal(
      resolveSendDeliveryLifecycleLabelKey("delivered"),
      "mail.compose.deliveredQueued",
    );
  });

  it("keeps approval separate from each send delivery state", () => {
    const cases: Array<{
      status: SendOperationApiItem["status"];
      phase: ReturnType<typeof resolveApprovedOutboundDisplayPhase>;
      label: string;
    }> = [
      {
        status: "pending",
        phase: "waiting_to_send",
        label: "mail.compose.waitingToSend",
      },
      {
        status: "processing",
        phase: "sending",
        label: "mail.compose.sendingQueued",
      },
      {
        status: "accepted",
        phase: "sent",
        label: "mail.compose.sentQueued",
      },
      {
        status: "failed",
        phase: "send_failed",
        label: "mail.compose.sendFailedQueued",
      },
      {
        status: "dispatch_uncertain",
        phase: "dispatch_uncertain",
        label: "mail.compose.dispatchUncertainQueued",
      },
    ];

    for (const testCase of cases) {
      const phase = resolveApprovedOutboundDisplayPhase({
        approval: approval(),
        send: sendOperation({ status: testCase.status }),
      });
      assert.equal(phase, testCase.phase);
      assert.equal(resolveSendDeliveryLifecycleLabelKey(phase), testCase.label);
    }
  });

  it("polls only non-terminal approved delivery phases", () => {
    for (const phase of ["approved_only", "waiting_to_send", "sending"] as const) {
      assert.equal(
        shouldLiveRefreshApprovedDetail({
          approvalStatus: "approved",
          phase,
        }),
        true,
      );
    }

    for (const phase of [
      "sent",
      "delivered",
      "send_failed",
      "dispatch_uncertain",
    ] as const) {
      assert.equal(
        shouldLiveRefreshApprovedDetail({
          approvalStatus: "approved",
          phase,
        }),
        false,
      );
    }
    assert.equal(
      shouldLiveRefreshApprovedDetail({
        approvalStatus: "pending",
        phase: "waiting_to_send",
      }),
      false,
    );
  });

  it("verifies send operation snapshot integrity against approved provenance", () => {
    assert.equal(
      assertSendOperationSnapshotIntegrity({
        approval: approval(),
        send: sendOperation(),
      }),
      true,
    );
    assert.equal(
      assertSendOperationSnapshotIntegrity({
        approval: approval(),
        send: sendOperation({ contentHash: "other-hash" }),
      }),
      false,
    );
  });

  it("uses deterministic idempotency keys for duplicate prevention", () => {
    assert.equal(
      buildApprovedSendIdempotencyKey("approval-1"),
      "mail:approval:approval-1:send",
    );
  });

  it("allows authors and reviewers to read approval send operations", () => {
    const item = approval();
    assert.equal(
      canReadApprovalSendOperation({
        actorUserId: "author-1",
        approval: item,
        canReviewApprovals: false,
      }),
      true,
    );
    assert.equal(
      canReadApprovalSendOperation({
        actorUserId: "other-user",
        approval: item,
        canReviewApprovals: false,
      }),
      false,
    );
    assert.equal(
      canReadApprovalSendOperation({
        actorUserId: "reviewer-1",
        approval: item,
        canReviewApprovals: true,
      }),
      true,
    );
  });
});

describe("approved outbound queue wiring", () => {
  it("enqueues send operations when approval is approved", () => {
    const approvalService = readFileSync(
      "src/lib/mail/outbound-approval-service.ts",
      "utf8",
    );
    const sendService = readFileSync(
      "src/lib/mail/send-operation-service.ts",
      "utf8",
    );
    const composeStatus = readFileSync(
      "src/components/mail/compose/mail-compose-submission-status.tsx",
      "utf8",
    );
    const approvalDetail = readFileSync(
      "src/components/mail/approval/mail-approval-detail-pane.tsx",
      "utf8",
    );
    const approvalWorkspace = readFileSync(
      "src/lib/mail/client/mail-approval-workspace-context.tsx",
      "utf8",
    );

    assert.match(approvalService, /buildSendOperationCreation/);
    assert.match(sendService, /buildSendOperationCreation/);
    assert.match(sendService, /status: "pending"/);
    assert.match(composeStatus, /resolveSendDeliveryLifecycleLabelKey/);
    assert.match(approvalDetail, /ApprovalDeliveryStatusSummary/);
    assert.match(approvalDetail, /resolveApprovedOutboundDisplayPhase/);
    assert.match(approvalDetail, /APPROVAL_DETAIL_LIVE_REFRESH_INTERVAL_MS/);
    assert.match(approvalDetail, /window\.setInterval\(/);
    assert.match(approvalDetail, /liveRefreshInFlightRef/);
    assert.match(approvalDetail, /document\.addEventListener\("visibilitychange"/);
    assert.match(approvalDetail, /window\.addEventListener\("focus"/);
    assert.match(approvalDetail, /refreshDeliveryStatus/);
    assert.doesNotMatch(approvalDetail, /selectApproval\(/);
    assert.doesNotMatch(approvalDetail, /setDetail\(null\)|setIsLoadingDetail\(true\)/);
    assert.match(approvalWorkspace, /refreshDeliveryStatus/);
    assert.match(approvalWorkspace, /setDetail\(\(previous\) =>/);
    assert.doesNotMatch(
      approvalDetail,
      /setActionMessage\(t\("mail\.adminCenter\.approval\.approveSuccess"\)\)/,
    );
  });
});
