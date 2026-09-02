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

    assert.match(approvalService, /buildSendOperationCreation/);
    assert.match(sendService, /buildSendOperationCreation/);
    assert.match(sendService, /status: "pending"/);
    assert.match(composeStatus, /resolveSendDeliveryLifecycleLabelKey/);
  });
});
