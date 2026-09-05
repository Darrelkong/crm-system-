"use client";

import { Paperclip, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import type { MailListRowPresentation } from "@/lib/mail/client/mail-workspace-ui-adapters";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import {
  getTeamMemberName,
  isSharedMailboxMessage,
  isUnreadForActor,
} from "@/lib/mail/prototype/shared-mailbox";
import type { MailFolderId } from "@/lib/mail/prototype/types";
import type { MailMessage } from "@/lib/mail/prototype/types";

function formatMailTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (sameDay) {
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}

export function MailMessageRow({
  row,
  message,
  selected,
  onSelect,
  activeFolder: activeFolderOverride,
  useProductionUnread = false,
  showSourceMailbox = false,
}: {
  row?: MailListRowPresentation;
  message?: MailMessage;
  selected: boolean;
  onSelect: () => void;
  activeFolder?: MailFolderId | "inbox" | "sent" | "trash" | "drafts";
  useProductionUnread?: boolean;
  showSourceMailbox?: boolean;
}) {
  const { t } = useTranslation();
  const { activeFolder: prototypeActiveFolder, currentTeamMemberId } =
    useMailPrototype();

  const activeFolder = activeFolderOverride ?? prototypeActiveFolder;
  const presentation =
    row ??
    (message
      ? {
          id: message.id,
          fromName: message.fromName,
          subject: message.subject,
          preview: message.preview,
          sentAt: message.sentAt,
          isUnread: false,
          isImportant: message.isImportant,
          hasAttachment: message.hasAttachment,
          deliveryStatus: message.deliveryStatus,
          processingStatus: message.processingStatus,
          assigneeId: message.assigneeId,
          draftRecipientCount: message.to.length,
          draftRecipientSummary:
            message.to.length > 0 ? message.to.join(", ") : null,
          sourceMailbox: undefined,
        }
      : null);

  if (!presentation) {
    return null;
  }

  const isUnread = useProductionUnread
    ? presentation.isUnread
    : message
      ? isUnreadForActor(message, currentTeamMemberId)
      : presentation.isUnread;
  const isShared = message ? isSharedMailboxMessage(message) : false;
  const processingStatus = presentation.processingStatus;
  const assignee = presentation.assigneeId;
  const showUnreadEmphasis = isUnread && !selected;
  const isDraftRow = activeFolder === "drafts";
  const draftRecipientSummary =
    presentation.draftRecipientSummary ??
    (message && message.to.length > 0 ? message.to.join(", ") : null);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "mail-message-row group relative grid w-full min-w-0 max-w-full grid-cols-[4px_minmax(0,1fr)] gap-x-0 text-left transition-colors",
        selected ? "mail-row-selected" : "mail-row-read",
      )}
    >
      <span
        className={cn(
          "my-2 rounded-full transition-colors",
          selected
            ? "mail-row-accent-selected"
            : showUnreadEmphasis
              ? "mail-row-accent-unread"
              : "bg-transparent group-hover:bg-black/[0.08] dark:group-hover:bg-white/[0.1]",
        )}
        aria-hidden
      />

      <div className="min-w-0 border-b crm-border px-3 py-2.5 sm:px-3.5">
        <div className="flex items-baseline justify-between gap-2">
          {!isDraftRow ? (
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px] leading-tight",
                selected || showUnreadEmphasis
                  ? "font-semibold crm-text"
                  : "font-medium crm-text",
              )}
            >
              {presentation.fromName}
            </span>
          ) : (
            <span className="min-w-0 flex-1" aria-hidden />
          )}
          <time
            dateTime={presentation.sentAt}
            className={cn(
              "shrink-0 whitespace-nowrap text-[11px] tabular-nums leading-tight",
              showUnreadEmphasis ? "font-medium crm-text" : "crm-text-secondary",
            )}
          >
            {formatMailTime(presentation.sentAt)}
          </time>
        </div>

        <p
          className={cn(
            "truncate text-[13px] leading-snug",
            isDraftRow ? "mt-0" : "mt-0.5",
            selected
              ? "font-medium crm-text"
              : showUnreadEmphasis
                ? "font-medium crm-text"
                : "font-normal crm-text",
          )}
        >
          {presentation.subject ||
            (isDraftRow ? t("mail.draft.noSubject") : "")}
        </p>

        {showSourceMailbox && presentation.sourceMailbox ? (
          <p className="mt-0.5 truncate text-[11px] leading-snug crm-text-secondary">
            {presentation.sourceMailbox.displayName ??
              presentation.sourceMailbox.address}
            {presentation.sourceMailbox.mailboxType === "shared"
              ? ` · ${t("mail.mailbox.shared")}`
              : ""}
          </p>
        ) : null}

        {isDraftRow ? (
          <>
            <p className="mt-0.5 truncate text-xs leading-snug crm-text-secondary">
              {draftRecipientSummary || t("mail.draft.noRecipient")}
            </p>
            {presentation.preview ? (
              <p className="mt-0.5 line-clamp-1 text-xs leading-snug crm-text-secondary">
                {presentation.preview}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-0.5 line-clamp-1 text-xs leading-snug crm-text-secondary">
            {presentation.preview}
          </p>
        )}

        {(presentation.hasAttachment ||
          presentation.isImportant ||
          presentation.deliveryStatus ||
          (isShared && processingStatus)) && (
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
            {presentation.isImportant && (
              <Star
                className="h-3 w-3 fill-amber-400 text-amber-500"
                aria-label={t("mail.flag.important")}
              />
            )}
            {presentation.hasAttachment && (
              <Paperclip
                className="h-3 w-3 shrink-0 crm-text-secondary"
                aria-label="Attachment"
              />
            )}
            {presentation.deliveryStatus && activeFolder === "sent" && (
              <span className="truncate text-[10px] crm-text-secondary">
                {t(`mail.delivery.${presentation.deliveryStatus}`)}
              </span>
            )}
            {isShared && processingStatus && (
              <span className="truncate text-[10px] crm-text-secondary">
                {t(`mail.shared.status.${processingStatus}`)}
                {assignee && processingStatus !== "unclaimed"
                  ? ` · ${getTeamMemberName(assignee)}`
                  : ""}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
