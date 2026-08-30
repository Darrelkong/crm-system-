import type { ApprovalApiItem } from "@/lib/mail/client/approval-workflow-management";

export type SendOperationApiItem = {
  id: string;
  outboundRevisionId: string;
  revisionChainId: string;
  contentHash: string;
  hashVersion: number;
  revisionKind: string;
  authorizationMode: "staff_approved" | "admin_direct";
  approvalId: string | null;
  idempotencyKey: string;
  status: "pending" | "processing" | "accepted" | "failed" | "dispatch_uncertain";
  orchestrationVersion: number;
  initiatedByUserId: string | null;
  createdAt: string;
  completedAt: string | null;
  nextAttemptAt: string | null;
  rfcIdentity?: {
    id: string;
    rfcMessageId: string;
    createdAt: string;
  };
};

export type OutboundQueuePhase =
  | "none"
  | "queued"
  | "ready_for_transport"
  | "processing"
  | "accepted"
  | "failed"
  | "dispatch_uncertain";

export type ApprovedOutboundDisplayPhase =
  | "approved_only"
  | "waiting_to_send"
  | "sending"
  | "sent"
  | "send_failed"
  | "dispatch_uncertain";

export type SendDeliveryLifecycleApiItem = {
  sendOperationId: string;
  sendStatus: SendOperationApiItem["status"];
  transportPhase: "queued" | "processing" | "accepted" | "failed";
  lifecyclePhase: SendDeliveryLifecyclePhase;
  recipients: Array<{
    recipientId: string;
    address: string;
    recipientType: string;
    outcome: "pending" | "deferred" | "delivered" | "bounced";
    latestEventType: "deferred" | "delivered" | "bounced" | null;
    latestEventAt: string | null;
    lifecycleHint: "complaint" | "provider_failed" | null;
  }>;
};

export type SendDeliveryLifecyclePhase =
  | "queued"
  | "processing"
  | "accepted"
  | "delivered"
  | "deferred"
  | "bounced"
  | "failed"
  | "complaint";

export type SendDeliveryDisplayPhase =
  | ApprovedOutboundDisplayPhase
  | "delivered"
  | "delivery_deferred"
  | "delivery_bounced"
  | "delivery_complaint";

export function approvalSendOperationPath(approvalId: string): string {
  return `/api/mail/approvals/${encodeURIComponent(approvalId)}/send-operation`;
}

export function buildApprovedSendIdempotencyKey(approvalId: string): string {
  return `mail:approval:${approvalId}:send`;
}

export function resolveOutboundQueuePhase(
  send: SendOperationApiItem | null,
): OutboundQueuePhase {
  if (!send) {
    return "none";
  }
  if (send.status === "pending") {
    return send.rfcIdentity ? "ready_for_transport" : "queued";
  }
  if (send.status === "processing") {
    return "processing";
  }
  if (send.status === "accepted") {
    return "accepted";
  }
  if (send.status === "dispatch_uncertain") {
    return "dispatch_uncertain";
  }
  return "failed";
}

export function sendOperationDeliveryPath(sendOperationId: string): string {
  return `/api/mail/send-operations/${encodeURIComponent(sendOperationId)}/delivery`;
}

export function resolveApprovedOutboundDisplayPhase(input: {
  approval: ApprovalApiItem | null;
  send: SendOperationApiItem | null;
  delivery?: Pick<SendDeliveryLifecycleApiItem, "lifecyclePhase"> | null;
}): SendDeliveryDisplayPhase {
  if (input.send?.authorizationMode === "admin_direct" && !input.approval) {
    return resolveAdminDirectOutboundDisplayPhase({
      send: input.send,
      delivery: input.delivery,
    });
  }
  if (!input.approval || input.approval.status !== "approved") {
    return "approved_only";
  }
  if (!input.send) {
    return "approved_only";
  }
  if (input.send.status === "pending") {
    return "waiting_to_send";
  }
  if (input.send.status === "processing") {
    return "sending";
  }
  if (input.send.status === "failed") {
    return "send_failed";
  }
  if (input.send.status === "dispatch_uncertain") {
    return "dispatch_uncertain";
  }

  if (input.delivery?.lifecyclePhase === "delivered") {
    return "delivered";
  }
  if (input.delivery?.lifecyclePhase === "deferred") {
    return "delivery_deferred";
  }
  if (input.delivery?.lifecyclePhase === "bounced") {
    return "delivery_bounced";
  }
  if (input.delivery?.lifecyclePhase === "complaint") {
    return "delivery_complaint";
  }

  return "sent";
}

export function resolveOutboundDisplayPhase(input: {
  approval: ApprovalApiItem | null;
  send: SendOperationApiItem | null;
  delivery?: Pick<SendDeliveryLifecycleApiItem, "lifecyclePhase"> | null;
}): SendDeliveryDisplayPhase {
  return resolveApprovedOutboundDisplayPhase(input);
}

function resolveAdminDirectOutboundDisplayPhase(input: {
  send: SendOperationApiItem;
  delivery?: Pick<SendDeliveryLifecycleApiItem, "lifecyclePhase"> | null;
}): SendDeliveryDisplayPhase {
  if (input.send.status === "pending") {
    return "waiting_to_send";
  }
  if (input.send.status === "processing") {
    return "sending";
  }
  if (input.send.status === "failed") {
    return "send_failed";
  }
  if (input.send.status === "dispatch_uncertain") {
    return "dispatch_uncertain";
  }

  if (input.delivery?.lifecyclePhase === "delivered") {
    return "delivered";
  }
  if (input.delivery?.lifecyclePhase === "deferred") {
    return "delivery_deferred";
  }
  if (input.delivery?.lifecyclePhase === "bounced") {
    return "delivery_bounced";
  }
  if (input.delivery?.lifecyclePhase === "complaint") {
    return "delivery_complaint";
  }

  return "sent";
}

export function resolveSendDeliveryLifecycleLabelKey(
  phase: SendDeliveryDisplayPhase,
): string {
  switch (phase) {
    case "waiting_to_send":
      return "mail.compose.waitingToSend";
    case "sending":
      return "mail.compose.sendingQueued";
    case "sent":
      return "mail.compose.sentQueued";
    case "send_failed":
      return "mail.compose.sendFailedQueued";
    case "dispatch_uncertain":
      return "mail.compose.dispatchUncertainQueued";
    case "delivered":
      return "mail.compose.deliveredQueued";
    case "delivery_deferred":
      return "mail.compose.deliveryDeferred";
    case "delivery_bounced":
      return "mail.compose.deliveryBounced";
    case "delivery_complaint":
      return "mail.compose.deliveryComplaint";
    default:
      return "mail.compose.approvedHint";
  }
}

export function assertSendOperationSnapshotIntegrity(input: {
  approval: ApprovalApiItem;
  send: SendOperationApiItem;
}): boolean {
  if (input.approval.status !== "approved") {
    return false;
  }
  if (input.send.approvalId !== input.approval.id) {
    return false;
  }
  if (input.send.outboundRevisionId !== input.approval.approvedRevisionId) {
    return false;
  }
  if (input.send.contentHash !== input.approval.approvedContentHash) {
    return false;
  }
  if (input.send.hashVersion !== input.approval.approvedHashVersion) {
    return false;
  }
  return true;
}

export function canReadApprovalSendOperation(input: {
  actorUserId: string;
  approval: ApprovalApiItem;
  canReviewApprovals: boolean;
}): boolean {
  if (input.approval.requestedByUserId === input.actorUserId) {
    return true;
  }
  return input.canReviewApprovals;
}
