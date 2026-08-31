"use client";

import { AlertCircle, Loader2, Paperclip, RotateCcw, X } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import type { ComposeAttachmentPolicyIssueCode } from "@/lib/mail/compose-attachment-policy";
import {
  composeAttachmentPolicyErrorParams,
  composeAttachmentRemoveMessageKey,
  composeAttachmentUploadErrorMessageKey,
} from "@/lib/mail/client/compose-attachment-upload";
import {
  composeAttachmentTrayKindKey,
  composeAttachmentTrayListClassName,
  composeAttachmentTrayRootClassName,
  composeAttachmentTraySummaryKey,
  summarizeComposeAttachments,
} from "@/lib/mail/client/compose-attachment-tray";
import type { ComposeAttachmentDraft } from "@/lib/mail/client/draft-management";

const POLICY_ATTACHMENT_ERROR_CODES = new Set<ComposeAttachmentPolicyIssueCode>([
  "FILE_TOO_LARGE",
  "TOTAL_SIZE_EXCEEDED",
  "TOO_MANY_ATTACHMENTS",
  "UNSUPPORTED_FILE_TYPE",
  "EMPTY_FILE",
  "FILENAME_REQUIRED",
]);

function attachmentErrorParams(
  errorCode: ComposeAttachmentDraft["errorCode"],
): Record<string, string> | undefined {
  if (
    !errorCode ||
    !POLICY_ATTACHMENT_ERROR_CODES.has(errorCode as ComposeAttachmentPolicyIssueCode)
  ) {
    return undefined;
  }
  return composeAttachmentPolicyErrorParams(
    errorCode as ComposeAttachmentPolicyIssueCode,
  );
}

function CompactAttachmentStatus({
  attachment,
}: {
  attachment: ComposeAttachmentDraft;
}) {
  const { t } = useTranslation();

  if (attachment.largeAttachmentExpired) {
    return (
      <p className="mt-0.5 break-words text-[11px] text-amber-700 dark:text-amber-400">
        {t("mail.compose.largeAttachment.expiredPlaceholder")}
      </p>
    );
  }

  if (
    attachment.uploadStatus === "preparing" ||
    attachment.uploadStatus === "hashing"
  ) {
    return (
      <p className="mt-0.5 truncate text-[11px] crm-text-secondary">
        {t(
          attachment.uploadStatus === "hashing"
            ? "mail.compose.largeAttachment.hashing"
            : "mail.compose.largeAttachment.preparing",
        )}
      </p>
    );
  }

  if (attachment.uploadStatus === "finalizing") {
    return (
      <p className="mt-0.5 truncate text-[11px] crm-text-secondary">
        {t("mail.compose.largeAttachment.finalizing")}
      </p>
    );
  }

  if (attachment.uploadStatus === "uploading") {
    return (
      <div className="mt-1 space-y-1">
        <div className="h-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div
            className="h-full rounded-full bg-blue-600 transition-all"
            style={{ width: `${attachment.uploadProgress}%` }}
          />
        </div>
        <p className="truncate text-[11px] crm-text-secondary">
          {t("mail.compose.attachment.uploading", {
            percent: String(attachment.uploadProgress),
          })}
        </p>
      </div>
    );
  }

  if (attachment.uploadStatus === "queued") {
    return (
      <p className="mt-0.5 truncate text-[11px] crm-text-secondary">
        {t("mail.compose.pendingUpload")}
      </p>
    );
  }

  if (attachment.uploadStatus === "failed") {
    return (
      <p className="mt-0.5 break-words text-[11px] text-red-600 dark:text-red-400">
        {attachment.errorCode
          ? t(
              composeAttachmentUploadErrorMessageKey(attachment.errorCode),
              attachmentErrorParams(attachment.errorCode),
            )
          : attachment.error ?? t("mail.compose.attachment.uploadFailed")}
      </p>
    );
  }

  return null;
}

export function MailComposeAttachmentList({
  attachments,
  variant,
  onRemove,
  onRetry,
  onCancel,
}: {
  attachments: ComposeAttachmentDraft[];
  variant: "embedded-mobile" | "floating-desktop";
  onRemove: (attachmentId: string) => void;
  onRetry: (attachmentId: string) => void;
  onCancel: (attachmentId: string) => void;
}) {
  const { t } = useTranslation();
  const summary = summarizeComposeAttachments(attachments);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={composeAttachmentTrayRootClassName(variant)}>
      <div className="mb-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="min-w-0 truncate text-xs font-medium crm-text">
          {t(composeAttachmentTraySummaryKey(), {
            count: String(summary.count),
            totalSize: summary.totalSizeLabel,
          })}
        </p>
        <p className="text-[11px] crm-text-secondary">
          {t(composeAttachmentTrayKindKey(attachments))}
        </p>
      </div>

      <div className={composeAttachmentTrayListClassName(variant)}>
        {attachments.map((attachment) => (
          <div
            key={attachment.id}
            className="mail-compose-attachment-item min-w-0 rounded-md border crm-border bg-[var(--color-crm-bg-muted)]/40 px-2 py-1.5"
          >
            <div className="flex min-w-0 items-start gap-2">
              <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 crm-text-secondary" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline gap-2">
                  <p
                    className="min-w-0 flex-1 truncate text-xs crm-text"
                    title={attachment.name}
                  >
                    {attachment.kind === "large_attachment"
                      ? `${t("mail.compose.largeAttachment.label")} · ${attachment.name}`
                      : attachment.name}
                  </p>
                  <span className="shrink-0 text-[11px] tabular-nums crm-text-secondary">
                    {attachment.sizeLabel}
                  </span>
                </div>
                <CompactAttachmentStatus attachment={attachment} />
                {attachment.uploadStatus === "failed" ? (
                  <button
                    type="button"
                    onClick={() => onRetry(attachment.id)}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] crm-text-secondary hover:crm-text"
                  >
                    <RotateCcw className="h-3 w-3" />
                    {t("mail.compose.attachment.retry")}
                  </button>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {attachment.uploadStatus === "uploading" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onCancel(attachment.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
                      aria-label={t("mail.compose.attachment.cancel")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <Loader2 className="h-3.5 w-3.5 animate-spin crm-text-secondary" />
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => onRemove(attachment.id)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
                    aria-label={t(composeAttachmentRemoveMessageKey())}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            {attachment.uploadStatus === "failed" ? (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {t("mail.compose.attachment.uploadFailed")}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
