"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/form";
import { MailApprovalStatusBadge } from "@/components/mail/shared/mail-approval-status-badge";
import { MailMessageBodyRenderer } from "@/components/mail/mail-message-body-renderer";
import {
  isApprovalDetailReadyForReview,
  useOptionalMailApprovalWorkspace,
} from "@/lib/mail/client/mail-approval-workspace-context";
import {
  buildOutboundRevisionAttachmentDownloadHref,
  formatAttachmentMimeLabel,
  isAttachmentBlockingApprovalReview,
} from "@/lib/mail/client/mail-approval-review-readiness";
import {
  formatApprovalRequesterLabel,
  formatRevisionRecipientsLabel,
  formatRevisionSenderLabel,
  isRejectReasonValid,
  type OutboundRevisionApiItem,
} from "@/lib/mail/client/approval-workflow-management";
import { formatAttachmentSize } from "@/lib/mail/client/draft-management";
import { postApprovalApprove, postApprovalReturn } from "@/lib/mail/client/api";
import { formatHongKongDateTime } from "@/lib/timezone";

function RecipientChipGroup({
  label,
  addresses,
}: {
  label: string;
  addresses: string[];
}) {
  if (addresses.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
      <span className="w-20 shrink-0 text-sm crm-text-secondary">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {addresses.map((address) => (
          <span
            key={address}
            className="mail-recipient-chip inline-flex max-w-full items-center rounded-full border crm-border bg-[var(--color-crm-bg-muted)] px-2.5 py-1 text-xs crm-text"
          >
            <span className="truncate">{address}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function MailApprovalFrozenAttachmentSection({
  revision,
}: {
  revision: OutboundRevisionApiItem;
}) {
  const { t } = useTranslation();
  const attachments = revision.attachments;

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 border-b crm-border py-5">
      <p className="text-xs font-medium uppercase tracking-wide crm-text-secondary">
        {t("mail.detail.attachments")}
      </p>
      <ul className="mail-attachment-list divide-y crm-border rounded-lg border crm-border">
        {attachments.map((attachment) => (
          <li
            key={attachment.id}
            className="mail-attachment-row flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium crm-text">
                {attachment.displayFilename}
              </p>
              <p className="mt-0.5 text-xs crm-text-secondary">
                <span>{formatAttachmentSize(attachment.sizeBytes)}</span>
                <span className="mx-1.5">·</span>
                <span className="font-medium crm-text">
                  {formatAttachmentMimeLabel(attachment.mimeType)}
                </span>
                {attachment.deliveryMode === "secure_file"
                  ? ` · ${t("mail.attachment.secureFile")}`
                  : null}
              </p>
            </div>
            <div className="shrink-0">
              {attachment.downloadAvailable ? (
                <a
                  href={buildOutboundRevisionAttachmentDownloadHref(
                    revision.id,
                    attachment.id,
                  )}
                  className={cn(
                    "secondary-button inline-flex min-h-9 items-center justify-center rounded-xl px-3 py-1.5 text-sm font-medium transition-all duration-200 ease-out",
                  )}
                  aria-label={`${t("common.download")} ${attachment.displayFilename}`}
                >
                  {t("common.download")}
                </a>
              ) : (
                <span className="text-xs crm-text-secondary">
                  {t("mail.attachment.downloadUnavailable")}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function resolveComposeModeLabelKey(composeMode: string): string {
  switch (composeMode) {
    case "reply":
    case "reply_all":
      return "mail.approval.composeMode.reply";
    case "forward":
      return "mail.approval.composeMode.forward";
    default:
      return "mail.approval.composeMode.new";
  }
}

export function MailApprovalDetailPane({ className }: { className?: string }) {
  const { t } = useTranslation();
  const approvalWorkspace = useOptionalMailApprovalWorkspace();
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const actionPendingRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [quotedExpanded, setQuotedExpanded] = useState(false);
  const [metadataExpanded, setMetadataExpanded] = useState(false);

  if (!approvalWorkspace) {
    return null;
  }

  const {
    selectedApprovalId,
    detail,
    isLoadingDetail,
    detailError,
    attachmentsLoadState,
    attachmentsLoadError,
    canReview,
    loadApprovals,
    refreshDetail,
  } = approvalWorkspace;

  if (!selectedApprovalId) {
    return (
      <div className={cn("flex min-h-0 flex-1 items-center justify-center px-6", className)}>
        <p className="text-sm crm-text-secondary">{t("mail.approval.selectItem")}</p>
      </div>
    );
  }

  if (isLoadingDetail) {
    return (
      <div className={cn("flex min-h-0 flex-1 items-center justify-center px-6", className)}>
        <p className="text-sm crm-text-secondary">{t("common.loading")}</p>
      </div>
    );
  }

  if (detailError) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6", className)}>
        <p className="text-sm text-red-600 dark:text-red-400">{detailError}</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => void refreshDetail()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className={cn("flex min-h-0 flex-1 items-center justify-center px-6", className)}>
        <p className="text-sm crm-text-secondary">{t("mail.approval.detailUnavailable")}</p>
      </div>
    );
  }

  const { approval, revision } = detail;
  const toRecipients = revision.recipients
    .filter((r) => r.recipientType === "to")
    .map((r) => (r.displayName ? `${r.displayName} <${r.address}>` : r.address));
  const ccRecipients = revision.recipients
    .filter((r) => r.recipientType === "cc")
    .map((r) => (r.displayName ? `${r.displayName} <${r.address}>` : r.address));
  const bccRecipients = revision.recipients
    .filter((r) => r.recipientType === "bcc")
    .map((r) => (r.displayName ? `${r.displayName} <${r.address}>` : r.address));

  const reviewReady = isApprovalDetailReadyForReview({
    detail,
    attachmentsLoadState,
    attachmentsLoadError,
  });
  const attachmentReviewBlocked = isAttachmentBlockingApprovalReview({
    detail,
    attachmentsLoadState,
    attachmentsLoadError,
  });
  const showActions = canReview && approval.status === "pending";

  async function handleApprove() {
    if (!reviewReady || actionPendingRef.current) return;
    actionPendingRef.current = true;
    setActionPending(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await postApprovalApprove(
        approval.id,
        approval.workflowVersion,
      );
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setActionMessage(t("mail.adminCenter.approval.approveSuccess"));
      await loadApprovals();
      await refreshDetail();
    } catch {
      setActionError(t("common.networkError"));
    } finally {
      actionPendingRef.current = false;
      setActionPending(false);
    }
  }

  async function handleReject() {
    if (actionPendingRef.current || !isRejectReasonValid(rejectReason)) return;
    actionPendingRef.current = true;
    setActionPending(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await postApprovalReturn(approval.id, {
        expectedWorkflowVersion: approval.workflowVersion,
        note: rejectReason.trim(),
      });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setRejecting(false);
      setRejectReason("");
      setActionMessage(t("mail.adminCenter.approval.rejectSuccess"));
      await loadApprovals();
      await refreshDetail();
    } catch {
      setActionError(t("common.networkError"));
    } finally {
      actionPendingRef.current = false;
      setActionPending(false);
    }
  }

  return (
    <div className={cn("mail-approval-detail flex min-h-0 min-w-0 flex-1 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mail-approval-detail-inner mx-auto w-full max-w-[52rem] px-4 py-5 sm:px-6">
          {actionMessage ? (
            <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300" role="status">
              {actionMessage}
            </p>
          ) : null}
          <div className="space-y-4 border-b crm-border pb-5">
            <div className="flex flex-wrap items-center gap-2">
              <MailApprovalStatusBadge status={approval.status} />
              <span className="text-sm crm-text-secondary">
                {t("mail.approval.requester")}:{" "}
                {formatApprovalRequesterLabel(detail.requesterLabel, t)}
              </span>
              <span className="text-sm crm-text-secondary">·</span>
              <span className="text-sm crm-text-secondary">
                {formatHongKongDateTime(approval.requestedAt)}
              </span>
            </div>
            <p className="text-sm crm-text-secondary">
              {t("mail.approval.composeType")}:{" "}
              {t(resolveComposeModeLabelKey(revision.composeMode))}
            </p>
          </div>

          <div className="space-y-3 border-b crm-border py-5">
            <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:gap-3">
              <span className="w-20 shrink-0 text-sm crm-text-secondary">
                {t("mail.compose.from")}
              </span>
              <span className="min-w-0 flex-1 break-words text-sm crm-text">
                {formatRevisionSenderLabel(revision)}
              </span>
            </div>
            <RecipientChipGroup label={t("mail.compose.to")} addresses={toRecipients} />
            <RecipientChipGroup label={t("mail.compose.cc")} addresses={ccRecipients} />
            <RecipientChipGroup label={t("mail.compose.bcc")} addresses={bccRecipients} />
            <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:gap-3">
              <span className="w-20 shrink-0 text-sm crm-text-secondary">
                {t("mail.compose.subject")}
              </span>
              <span className="min-w-0 flex-1 break-words text-sm font-medium crm-text">
                {revision.subject}
              </span>
            </div>
          </div>

          <MailApprovalFrozenAttachmentSection revision={revision} />

          <div className="space-y-3 border-b crm-border py-5">
            <p className="text-xs font-medium uppercase tracking-wide crm-text-secondary">
              {t("mail.approval.body")}
            </p>
            <MailMessageBodyRenderer
              bodyHtml={
                detail.editableBodyHtml.trim()
                  ? detail.editableBodyHtml
                  : revision.bodyHtmlSanitized
              }
              bodyText={revision.bodyText}
              className="mail-reading-body text-sm leading-relaxed crm-text"
            />

            {detail.quotedBodyHtml ? (
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => setQuotedExpanded((value) => !value)}
                  className="inline-flex items-center gap-1 text-sm crm-text-secondary hover:crm-text"
                >
                  {quotedExpanded ? (
                    <ChevronDown className="h-4 w-4" aria-hidden />
                  ) : (
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  )}
                  {t("mail.compose.showQuoted")}
                </button>
                {quotedExpanded ? (
                  <MailMessageBodyRenderer
                    bodyHtml={detail.quotedBodyHtml}
                    bodyText={null}
                    className="mail-approval-quoted mt-3 rounded-lg border crm-border bg-[var(--color-crm-bg-muted)] px-4 py-3 text-sm leading-relaxed crm-text-secondary"
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="border-t crm-border pt-4">
            <button
              type="button"
              onClick={() => setMetadataExpanded((value) => !value)}
              className="inline-flex items-center gap-1 text-xs crm-text-secondary hover:crm-text"
            >
              {metadataExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              )}
              {t("mail.approval.metadata")}
            </button>
            {metadataExpanded ? (
              <dl className="mt-3 space-y-2 text-xs crm-text-secondary">
                <div>
                  <dt className="inline">{t("mail.approval.requester")}: </dt>
                  <dd className="inline crm-text">
                    {formatApprovalRequesterLabel(detail.requesterLabel, t)}
                  </dd>
                </div>
                <div>
                  <dt className="inline">{t("mail.approval.recipientsSummary")}: </dt>
                  <dd className="inline crm-text">
                    {formatRevisionRecipientsLabel(revision)}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>
        </div>
      </div>

      {showActions ? (
        <div className="sticky bottom-0 border-t crm-border bg-[var(--color-crm-bg)] px-4 py-3 sm:px-6">
          {actionError ? (
            <p className="mb-2 text-sm text-red-600 dark:text-red-400">{actionError}</p>
          ) : null}
          {attachmentReviewBlocked ? (
            <p className="mb-2 text-sm crm-text-secondary">
              {attachmentsLoadError
                ? t(attachmentsLoadError)
                : t("mail.approval.attachmentReviewBlocked")}
            </p>
          ) : !reviewReady ? (
            <p className="mb-2 text-sm crm-text-secondary">
              {t("mail.approval.reviewNotReady")}
            </p>
          ) : null}
          {rejecting ? (
            <div className="space-y-3">
              <Label htmlFor="mail-approval-reject-reason">
                {t("mail.adminCenter.approval.rejectReasonLabel")}
              </Label>
              <Textarea
                id="mail-approval-reject-reason"
                className="min-h-24"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder={t("mail.adminCenter.approval.rejectReasonPlaceholder")}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="danger"
                  disabled={actionPending || !isRejectReasonValid(rejectReason)}
                  onClick={() => void handleReject()}
                >
                  {t("mail.adminCenter.approval.rejectAction")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={actionPending}
                  onClick={() => {
                    setRejecting(false);
                    setRejectReason("");
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="danger"
                disabled={actionPending}
                onClick={() => setRejecting(true)}
              >
                  {actionPending
                    ? t("mail.adminCenter.approval.rejectPending")
                    : t("mail.adminCenter.approval.rejectAction")}
              </Button>
              <Button
                type="button"
                disabled={!reviewReady || actionPending}
                  aria-busy={actionPending}
                onClick={() => void handleApprove()}
              >
                  {actionPending
                    ? t("mail.adminCenter.approval.approvePending")
                    : t("mail.adminCenter.approval.approveAction")}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
