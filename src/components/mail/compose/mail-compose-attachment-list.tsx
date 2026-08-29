"use client";

import { AlertCircle, Loader2, Paperclip, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import {
  composeAttachmentRemoveMessageKey,
  composeAttachmentUploadErrorMessageKey,
} from "@/lib/mail/client/compose-attachment-upload";
import type { ComposeAttachmentDraft } from "@/lib/mail/client/draft-management";

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
  const isMobile = variant === "embedded-mobile";

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 border-t crm-border px-3 py-3">
      <p className="text-xs font-medium uppercase tracking-wide crm-text-secondary">
        {t("mail.compose.attachments")}
      </p>
      <div className={cn("grid gap-2", isMobile ? "grid-cols-1" : "grid-cols-1")}>
        {attachments.map((attachment) => (
          <div
            key={attachment.id}
            className={cn(
              "flex items-start justify-between gap-3 rounded-lg border crm-border px-3 py-2 text-sm",
              isMobile && "shadow-sm",
            )}
          >
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <Paperclip className="mt-0.5 h-4 w-4 shrink-0 crm-text-secondary" />
              <div className="min-w-0 flex-1">
                <p className="truncate crm-text">{attachment.name}</p>
                <p className="text-xs crm-text-secondary">{attachment.sizeLabel}</p>
                {attachment.uploadStatus === "uploading" ? (
                  <div className="mt-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                      <div
                        className="h-full rounded-full bg-blue-600 transition-all"
                        style={{ width: `${attachment.uploadProgress}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs crm-text-secondary">
                      {t("mail.compose.attachment.uploading", {
                        percent: String(attachment.uploadProgress),
                      })}
                    </p>
                  </div>
                ) : null}
                {attachment.uploadStatus === "queued" ? (
                  <p className="mt-1 text-xs crm-text-secondary">
                    {t("mail.compose.pendingUpload")}
                  </p>
                ) : null}
                {attachment.uploadStatus === "failed" ? (
                  <div className="mt-1 space-y-0.5">
                    <p className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      {t("mail.compose.attachment.uploadFailed")}
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {attachment.errorCode
                        ? t(
                            composeAttachmentUploadErrorMessageKey(
                              attachment.errorCode,
                            ),
                          )
                        : attachment.error ??
                          t("mail.compose.attachment.uploadFailed")}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {attachment.uploadStatus === "uploading" ? (
                <button
                  type="button"
                  onClick={() => onCancel(attachment.id)}
                  className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
                >
                  <X className="h-3.5 w-3.5" />
                  {t("mail.compose.attachment.cancel")}
                </button>
              ) : null}
              {attachment.uploadStatus === "failed" ? (
                <button
                  type="button"
                  onClick={() => onRetry(attachment.id)}
                  className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t("mail.compose.attachment.retry")}
                </button>
              ) : null}
              {attachment.uploadStatus === "uploading" ? (
                <Loader2 className="h-4 w-4 animate-spin crm-text-secondary" />
              ) : (
                <button
                  type="button"
                  onClick={() => onRemove(attachment.id)}
                  className="inline-flex h-8 items-center rounded-md px-2 text-xs crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
                >
                  {t(composeAttachmentRemoveMessageKey())}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
