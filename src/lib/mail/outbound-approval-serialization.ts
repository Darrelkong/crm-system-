import type { MailOutboundApproval } from "../../../drizzle/schema/mail-outbound-approvals";
import type { MailOutboundApprovalEvent } from "../../../drizzle/schema/mail-outbound-approval-events";
import type { MailOutboundRevision } from "../../../drizzle/schema/mail-outbound-revisions";
import type { SafeOutboundRevisionRecipientView } from "@/lib/mail/outbound-revision-serialization";

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

export type SafeApprovalRevisionSummaryView = {
  id: string;
  revisionChainId: string;
  revisionNumber: number;
  fromAddress: string;
  fromDisplayName: string | null;
  subject: string;
  composeMode: MailOutboundRevision["composeMode"];
  createdAt: string;
  recipients: SafeOutboundRevisionRecipientView[];
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
  currentRevisionSummary?: SafeApprovalRevisionSummaryView;
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
  currentRevisionSummary?: SafeApprovalRevisionSummaryView,
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
    ...(currentRevisionSummary ? { currentRevisionSummary } : {}),
    ...(events ? { events: events.map(toSafeApprovalEventView) } : {}),
  };
}
