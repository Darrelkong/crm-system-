import type { MailOutboundApproval } from "../../../drizzle/schema/mail-outbound-approvals";
import type { MailOutboundApprovalEvent } from "../../../drizzle/schema/mail-outbound-approval-events";

export type SafeApprovalEventView = {
  id: string;
  eventType: MailOutboundApprovalEvent["eventType"];
  workflowVersion: number;
  actorUserId: string | null;
  revisionId: string | null;
  contentHash: string | null;
  hashVersion: number | null;
  note: string | null;
  createdAt: string;
};

export type SafeApprovalView = {
  id: string;
  revisionChainId: string;
  status: MailOutboundApproval["status"];
  priority: MailOutboundApproval["priority"];
  workflowVersion: number;
  currentRevisionId: string;
  currentContentHash: string;
  currentHashVersion: number;
  approvedRevisionId: string | null;
  approvedContentHash: string | null;
  approvedHashVersion: number | null;
  requestedByUserId: string;
  requestedAt: string;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  events?: SafeApprovalEventView[];
};

export function toSafeApprovalEventView(
  event: MailOutboundApprovalEvent,
): SafeApprovalEventView {
  return {
    id: event.id,
    eventType: event.eventType,
    workflowVersion: event.workflowVersion,
    actorUserId: event.actorUserId,
    revisionId: event.revisionId,
    contentHash: event.contentHash,
    hashVersion: event.hashVersion,
    note: event.note,
    createdAt: event.createdAt,
  };
}

export function toSafeApprovalView(
  approval: MailOutboundApproval,
  events?: MailOutboundApprovalEvent[],
): SafeApprovalView {
  return {
    id: approval.id,
    revisionChainId: approval.revisionChainId,
    status: approval.status,
    priority: approval.priority,
    workflowVersion: approval.workflowVersion,
    currentRevisionId: approval.currentRevisionId,
    currentContentHash: approval.currentContentHash,
    currentHashVersion: approval.currentHashVersion,
    approvedRevisionId: approval.approvedRevisionId,
    approvedContentHash: approval.approvedContentHash,
    approvedHashVersion: approval.approvedHashVersion,
    requestedByUserId: approval.requestedByUserId,
    requestedAt: approval.requestedAt,
    resolvedByUserId: approval.resolvedByUserId,
    resolvedAt: approval.resolvedAt,
    ...(events ? { events: events.map(toSafeApprovalEventView) } : {}),
  };
}
