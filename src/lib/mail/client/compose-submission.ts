import type { ApprovalApiItem } from "@/lib/mail/client/approval-workflow-management";
import type { SendOperationApiItem } from "@/lib/mail/client/approved-outbound-queue";
import {
  buildRecipientLists,
  isAuthorizedComposeSelection,
  stripHtml,
  type ComposeContextOption,
  type ComposeEditorState,
} from "@/lib/mail/client/draft-management";
import {
  countUniqueRecipients,
  isValidEmail,
  normalizeEmail,
} from "@/lib/mail/client/recipient-input";

export type ComposeSubmissionIssueCode =
  | "FROM_REQUIRED"
  | "FROM_UNAUTHORIZED"
  | "RECIPIENTS_REQUIRED"
  | "RECIPIENTS_INVALID"
  | "SUBJECT_REQUIRED"
  | "BODY_REQUIRED"
  | "ATTACHMENTS_PENDING"
  | "ALREADY_PENDING"
  | "ALREADY_APPROVED";

export type ComposeSubmissionValidationResult =
  | { ok: true }
  | { ok: false; issues: ComposeSubmissionIssueCode[] };

export type ComposeSubmissionPhase =
  | "draft"
  | "submitting"
  | "pending_approval"
  | "returned"
  | "approved";

export function draftRevisionPath(draftId: string): string {
  return `/api/mail/drafts/${encodeURIComponent(draftId)}/revisions`;
}

export function draftAdminDirectRevisionPath(draftId: string): string {
  return `/api/mail/drafts/${encodeURIComponent(draftId)}/admin-direct-revision`;
}

export function submitRevisionApprovalPath(revisionId: string): string {
  return `/api/mail/outbound-revisions/${encodeURIComponent(revisionId)}/submit-approval`;
}

export function sendAdminDirectPath(revisionId: string): string {
  return `/api/mail/outbound-revisions/${encodeURIComponent(revisionId)}/send-admin-direct`;
}

export function buildAdminDirectSendIdempotencyKey(revisionId: string): string {
  return `mail:admin-direct:${revisionId}:send`;
}

/** CRM root admin own-compose uses admin_direct; Staff uses staff approval workflow. */
export function resolveComposeOutboundWorkflow(
  isCrmRootAdmin: boolean,
): "admin_direct" | "staff_approved" {
  return isCrmRootAdmin ? "admin_direct" : "staff_approved";
}

export function approvalResubmitPath(approvalId: string): string {
  return `/api/mail/approvals/${encodeURIComponent(approvalId)}/resubmit`;
}

export function resolveComposeSubmissionPhase(input: {
  submitting: boolean;
  approval: ApprovalApiItem | null;
  send?: SendOperationApiItem | null;
}): ComposeSubmissionPhase {
  if (input.submitting) {
    return "submitting";
  }
  if (!input.approval) {
    if (input.send?.authorizationMode === "admin_direct") {
      return "approved";
    }
    return "draft";
  }
  if (input.approval.status === "pending") {
    return "pending_approval";
  }
  if (input.approval.status === "returned") {
    return "returned";
  }
  if (input.approval.status === "approved") {
    return "approved";
  }
  return "draft";
}

export function isAdminDirectSendBlockingResubmit(
  send: SendOperationApiItem | null | undefined,
): boolean {
  if (!send || send.authorizationMode !== "admin_direct") {
    return false;
  }
  return send.status !== "failed";
}

export function validateComposeForSubmission(
  state: ComposeEditorState,
  composeOptions: ComposeContextOption[],
  approval: ApprovalApiItem | null,
): ComposeSubmissionValidationResult {
  const issues: ComposeSubmissionIssueCode[] = [];

  if (!state.senderIdentityId || !state.mailboxId) {
    issues.push("FROM_REQUIRED");
  } else if (
    !isAuthorizedComposeSelection(
      composeOptions,
      state.senderIdentityId,
      state.mailboxId,
    )
  ) {
    issues.push("FROM_UNAUTHORIZED");
  }

  const lists = buildRecipientLists(state);
  if (countUniqueRecipients(lists) === 0) {
    issues.push("RECIPIENTS_REQUIRED");
  } else {
    for (const chips of [lists.to, lists.cc, lists.bcc]) {
      for (const chip of chips) {
        if (!isValidEmail(chip.email)) {
          issues.push("RECIPIENTS_INVALID");
          break;
        }
      }
    }
  }

  if (!state.subject.trim()) {
    issues.push("SUBJECT_REQUIRED");
  }

  if (!stripHtml(state.bodyHtml).trim()) {
    issues.push("BODY_REQUIRED");
  }

  if (state.attachments.some((attachment) => attachment.pendingUpload)) {
    issues.push("ATTACHMENTS_PENDING");
  }

  if (approval?.status === "pending") {
    issues.push("ALREADY_PENDING");
  }
  if (approval?.status === "approved") {
    issues.push("ALREADY_APPROVED");
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

export function canSubmitComposeForApproval(
  state: ComposeEditorState,
  composeOptions: ComposeContextOption[],
  approval: ApprovalApiItem | null,
  send?: SendOperationApiItem | null,
): boolean {
  if (isAdminDirectSendBlockingResubmit(send)) {
    return false;
  }
  return validateComposeForSubmission(state, composeOptions, approval).ok;
}

export function findAuthorApprovalForDraft(
  draftId: string,
  approvals: ApprovalApiItem[],
  revisionsById: Map<string, { sourceDraftId: string | null }>,
): ApprovalApiItem | null {
  let latest: ApprovalApiItem | null = null;

  for (const approval of approvals) {
    if (approval.status === "withdrawn") {
      continue;
    }
    const revision = revisionsById.get(approval.currentRevisionId);
    if (!revision || revision.sourceDraftId !== draftId) {
      continue;
    }
    if (
      !latest ||
      approval.requestedAt.localeCompare(latest.requestedAt) > 0
    ) {
      latest = approval;
    }
  }

  return latest;
}

export function buildSubmissionIssueMessageKey(
  issue: ComposeSubmissionIssueCode,
): string {
  switch (issue) {
    case "FROM_REQUIRED":
      return "mail.compose.validation.fromRequired";
    case "FROM_UNAUTHORIZED":
      return "mail.compose.validation.fromUnauthorized";
    case "RECIPIENTS_REQUIRED":
      return "mail.compose.validation.recipientsRequired";
    case "RECIPIENTS_INVALID":
      return "mail.recipient.invalidFormat";
    case "SUBJECT_REQUIRED":
      return "mail.recipient.subjectRequired";
    case "BODY_REQUIRED":
      return "mail.compose.validation.bodyRequired";
    case "ATTACHMENTS_PENDING":
      return "mail.compose.validation.attachmentsPending";
    case "ALREADY_PENDING":
      return "mail.compose.validation.alreadyPending";
    case "ALREADY_APPROVED":
      return "mail.compose.validation.alreadyApproved";
    default:
      return "mail.compose.validation.submitBlocked";
  }
}

export function normalizeRecipientEmailsForSummary(
  state: Pick<ComposeEditorState, "to" | "cc" | "bcc">,
): string[] {
  const emails: string[] = [];
  for (const chips of [state.to, state.cc, state.bcc]) {
    for (const chip of chips) {
      emails.push(normalizeEmail(chip.email));
    }
  }
  return emails;
}

export function resolveComposeSubmittingLabelKey(input: {
  workflow: "admin_direct" | "staff_approved";
}): string {
  return input.workflow === "admin_direct"
    ? "mail.compose.submittingSend"
    : "mail.compose.submittingApproval";
}

export function resolveComposeSubmitButtonLabelKey(input: {
  submitting: boolean;
  workflow: "admin_direct" | "staff_approved";
  approvalReturned: boolean;
}): string {
  if (input.submitting) {
    return resolveComposeSubmittingLabelKey({ workflow: input.workflow });
  }
  if (input.workflow === "admin_direct") {
    return "mail.compose.send";
  }
  if (input.approvalReturned) {
    return "mail.compose.resubmitApproval";
  }
  return "mail.compose.submitApproval";
}

export function isComposeI18nMessageKey(message: string): boolean {
  return message.startsWith("mail.");
}

export function resolveComposeSubmissionErrorMessage(
  message: string,
  translate: (key: string, params?: Record<string, string>) => string,
  params?: Record<string, string>,
): string {
  if (isComposeI18nMessageKey(message)) {
    return translate(message, params);
  }
  return message;
}
