import type { MailAdminCenterCapabilities } from "@/lib/mail/mail-session-context";
import type { MailAccessAdminUser } from "@/lib/mail/client/mail-access-management";

export type ApprovalStatus = "pending" | "returned" | "withdrawn" | "approved";
export type ApprovalListStatus = ApprovalStatus | "all-reviewed";

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

export type ApprovalRevisionSummaryApiItem = {
  id: string;
  revisionChainId: string;
  revisionNumber: number;
  fromAddress: string;
  fromDisplayName: string | null;
  subject: string;
  composeMode: string;
  createdAt: string;
  recipients: OutboundRevisionRecipientApiItem[];
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
  currentRevisionSummary?: ApprovalRevisionSummaryApiItem;
  events?: ApprovalEventApiItem[];
};

export type OutboundRevisionRecipientApiItem = {
  recipientType: "to" | "cc" | "bcc";
  address: string;
  displayName: string | null;
  sortOrder: number;
};

export type OutboundRevisionAttachmentApiItem = {
  id: string;
  displayFilename: string;
  mimeType: string;
  sizeBytes: number;
  deliveryMode: "direct_attachment" | "secure_file";
  sortOrder: number;
  downloadAvailable: boolean;
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
  attachments: OutboundRevisionAttachmentApiItem[];
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
  reviewedAt: string | null;
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

export type ApprovalHistoryFilter = "all" | "approved" | "rejected";

export type ApprovalHistoryResult = "approved" | "rejected" | "withdrawn";

export function isApprovalHistoryStatus(status: ApprovalStatus): boolean {
  return status !== "pending";
}

export function resolveApprovalHistoryResult(
  status: ApprovalStatus,
): ApprovalHistoryResult | null {
  if (status === "approved") {
    return "approved";
  }
  if (status === "returned") {
    return "rejected";
  }
  if (status === "withdrawn") {
    return "withdrawn";
  }
  return null;
}

export function filterApprovalHistoryRows(
  rows: ApprovalWorkflowRow[],
  filter: ApprovalHistoryFilter,
): ApprovalWorkflowRow[] {
  return rows.filter((row) => {
    const result = resolveApprovalHistoryResult(row.status);
    if (!result) {
      return false;
    }
    if (filter === "approved") {
      return result === "approved";
    }
    if (filter === "rejected") {
      return result === "rejected";
    }
    return true;
  });
}

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

export const APPROVAL_UNKNOWN_REQUESTER_LABEL_KEY =
  "mail.approval.unknownRequester";

export type ApprovalRequesterSessionUser = {
  id: string;
  email: string;
  name: string;
};

export function enrichApprovalRequesterUsers(
  users: MailAccessAdminUser[],
  sessionUser?: ApprovalRequesterSessionUser | null,
): MailAccessAdminUser[] {
  if (!sessionUser?.id) {
    return users;
  }
  if (users.some((user) => user.id === sessionUser.id)) {
    return users;
  }
  return [
    ...users,
    {
      id: sessionUser.id,
      email: sessionUser.email,
      name: sessionUser.name,
      status: "active",
    },
  ];
}

export function buildApprovalRequesterUsersById(
  users: MailAccessAdminUser[],
  sessionUser?: ApprovalRequesterSessionUser | null,
): Map<string, MailAccessAdminUser> {
  return new Map(
    enrichApprovalRequesterUsers(users, sessionUser).map(
      (user) => [user.id, user] as const,
    ),
  );
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

export function resolveApprovalRequesterLabel(
  userId: string,
  usersById: Map<string, MailAccessAdminUser>,
): string {
  const user = usersById.get(userId);
  if (!user) {
    return APPROVAL_UNKNOWN_REQUESTER_LABEL_KEY;
  }
  const label = user.name?.trim() || user.email?.trim();
  return label || APPROVAL_UNKNOWN_REQUESTER_LABEL_KEY;
}

export function formatApprovalRequesterLabel(
  label: string,
  translate: (key: string) => string,
): string {
  if (label === APPROVAL_UNKNOWN_REQUESTER_LABEL_KEY) {
    return translate(APPROVAL_UNKNOWN_REQUESTER_LABEL_KEY);
  }
  return label;
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
    const revision =
      revisionsById.get(approval.currentRevisionId) ??
      approval.currentRevisionSummary ??
      null;
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
      reviewedAt: approval.resolvedAt,
      submitterLabel: resolveApprovalRequesterLabel(
        approval.requestedByUserId,
        usersById,
      ),
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
  status?: ApprovalListStatus;
}): string {
  const params = new URLSearchParams({ scope: input.scope });
  if (input.status) {
    params.set("status", input.status);
  }
  return `${APPROVALS_PATH}?${params.toString()}`;
}
