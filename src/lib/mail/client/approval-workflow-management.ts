import type { MailAdminCenterCapabilities } from "@/lib/mail/mail-session-context";
import type { MailAccessAdminUser } from "@/lib/mail/client/mail-access-management";

export type ApprovalStatus = "pending" | "returned" | "withdrawn" | "approved";

export type ApprovalEventApiItem = {
  id: string;
  eventType:
    | "submitted"
    | "resubmitted"
    | "returned"
    | "withdrawn"
    | "approved"
    | "admin_edit"
    | "reminder_sent";
  workflowVersion: number;
  actorUserId: string | null;
  revisionId: string | null;
  contentHash: string | null;
  hashVersion: number | null;
  note: string | null;
  createdAt: string;
};

export type ApprovalApiItem = {
  id: string;
  revisionChainId: string;
  status: ApprovalStatus;
  priority: "normal" | "urgent";
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
  events?: ApprovalEventApiItem[];
};

export type OutboundRevisionRecipientApiItem = {
  recipientType: "to" | "cc" | "bcc";
  address: string;
  displayName: string | null;
  sortOrder: number;
};

export type OutboundRevisionApiItem = {
  id: string;
  revisionChainId: string;
  revisionNumber: number;
  parentRevisionId: string | null;
  sourceDraftId: string | null;
  revisionKind: string;
  mailboxId: string;
  senderIdentityId: string;
  fromAddress: string;
  fromDisplayName: string | null;
  subject: string;
  bodyText: string;
  bodyHtmlSanitized: string | null;
  sensitivity: string;
  composeMode: string;
  signatureSnapshotId: string;
  contentHash: string;
  hashVersion: number;
  createdAt: string;
  createdByUserId: string;
  recipients: OutboundRevisionRecipientApiItem[];
};

export type ApprovalWorkflowScope = "reviewer" | "author";

export type ApprovalWorkflowRow = {
  id: string;
  status: ApprovalStatus;
  priority: "normal" | "urgent";
  workflowVersion: number;
  senderLabel: string;
  recipientsLabel: string;
  subject: string;
  submittedAt: string;
  submitterLabel: string;
  approverLabel: string;
  returnReason: string | null;
  events: ApprovalEventApiItem[];
};

export type ApprovalWorkflowRowActions = {
  showApprove: boolean;
  showReject: boolean;
  showHistory: boolean;
};

export function canViewApprovalWorkflow(
  capabilities: Pick<MailAdminCenterCapabilities, "approvalWorkflowView">,
): boolean {
  return capabilities.approvalWorkflowView;
}

export function canReviewApprovals(
  capabilities: Pick<MailAdminCenterCapabilities, "approvalReviewManagement">,
): boolean {
  return capabilities.approvalReviewManagement;
}

export function resolveUserLabel(
  userId: string | null,
  usersById: Map<string, MailAccessAdminUser>,
): string {
  if (!userId) {
    return "—";
  }
  const user = usersById.get(userId);
  if (!user) {
    return userId;
  }
  return user.name || user.email;
}

export function formatRevisionSenderLabel(
  revision: Pick<OutboundRevisionApiItem, "fromAddress" | "fromDisplayName"> | null,
): string {
  if (!revision) {
    return "—";
  }
  if (revision.fromDisplayName?.trim()) {
    return `${revision.fromDisplayName} <${revision.fromAddress}>`;
  }
  return revision.fromAddress;
}

export function formatRevisionRecipientsLabel(
  revision: Pick<OutboundRevisionApiItem, "recipients"> | null,
): string {
  if (!revision || revision.recipients.length === 0) {
    return "—";
  }
  return revision.recipients
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((recipient) => recipient.address)
    .join(", ");
}

export function resolveLatestReturnReason(
  events: ApprovalEventApiItem[],
): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.eventType === "returned" && event.note?.trim()) {
      return event.note.trim();
    }
  }
  return null;
}

export function sortApprovalEvents(events: ApprovalEventApiItem[]): ApprovalEventApiItem[] {
  return events.slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function buildApprovalWorkflowRows(
  approvals: ApprovalApiItem[],
  revisionsById: Map<string, OutboundRevisionApiItem>,
  users: MailAccessAdminUser[],
): ApprovalWorkflowRow[] {
  const usersById = new Map(users.map((user) => [user.id, user] as const));

  return approvals.map((approval) => {
    const revision = revisionsById.get(approval.currentRevisionId) ?? null;
    const events = sortApprovalEvents(approval.events ?? []);
    return {
      id: approval.id,
      status: approval.status,
      priority: approval.priority,
      workflowVersion: approval.workflowVersion,
      senderLabel: formatRevisionSenderLabel(revision),
      recipientsLabel: formatRevisionRecipientsLabel(revision),
      subject: revision?.subject?.trim() || "—",
      submittedAt: approval.requestedAt,
      submitterLabel: resolveUserLabel(approval.requestedByUserId, usersById),
      approverLabel: resolveUserLabel(approval.resolvedByUserId, usersById),
      returnReason: resolveLatestReturnReason(events),
      events,
    };
  });
}

export function resolveApprovalWorkflowRowActions(
  row: ApprovalWorkflowRow,
  canReview: boolean,
): ApprovalWorkflowRowActions {
  if (!canReview) {
    return {
      showApprove: false,
      showReject: false,
      showHistory: row.events.length > 0,
    };
  }
  return {
    showApprove: row.status === "pending",
    showReject: row.status === "pending",
    showHistory: row.events.length > 0,
  };
}

export function isRejectReasonValid(reason: string): boolean {
  return Boolean(reason.trim());
}

export const APPROVALS_PATH = "/api/mail/approvals";

export function approvalPath(approvalId: string): string {
  return `/api/mail/approvals/${encodeURIComponent(approvalId)}`;
}

export function approvalApprovePath(approvalId: string): string {
  return `/api/mail/approvals/${encodeURIComponent(approvalId)}/approve`;
}

export function approvalReturnPath(approvalId: string): string {
  return `/api/mail/approvals/${encodeURIComponent(approvalId)}/return`;
}

export function outboundRevisionPath(revisionId: string): string {
  return `/api/mail/outbound-revisions/${encodeURIComponent(revisionId)}`;
}

export function buildApprovalsListPath(input: {
  scope: ApprovalWorkflowScope;
  status?: ApprovalStatus;
}): string {
  const params = new URLSearchParams({ scope: input.scope });
  if (input.status) {
    params.set("status", input.status);
  }
  return `${APPROVALS_PATH}?${params.toString()}`;
}
