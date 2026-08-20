"use client";

import { Paperclip, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import type { MailMessage } from "@/lib/mail/prototype/types";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import {
  getTeamMemberName,
  isSharedMailboxMessage,
  isUnreadForActor,
} from "@/lib/mail/prototype/shared-mailbox";

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
  return `${month}-${day}`;
}

export function MailMessageRow({
  message,
  selected,
  onSelect,
}: {
  message: MailMessage;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const { activeFolder, currentTeamMemberId } = useMailPrototype();

  const isUnread = isUnreadForActor(message, currentTeamMemberId);
  const isShared = isSharedMailboxMessage(message);
  const processingStatus = message.processingStatus;
  const assignee = message.assigneeId;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "grid w-full min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2 border-b crm-border px-3 py-2 text-left transition-colors sm:px-4",
        selected
          ? "mail-row-selected border-l-2 border-l-[var(--color-crm-primary)]"
          : "border-l-2 border-l-transparent hover:bg-black/[0.02] dark:hover:bg-white/[0.03]",
      )}
    >
      <div className="flex w-2 shrink-0 flex-col items-center gap-1 pt-1.5">
        {isUnread && (
          <span className="h-2 w-2 rounded-full bg-blue-500" aria-hidden />
        )}
        {message.isImportant && (
          <Star
            className="h-3 w-3 fill-amber-400 text-amber-500"
            aria-label={t("mail.flag.important")}
          />
        )}
      </div>

      <div className="min-w-0">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2">
          <span
            className={cn(
              "min-w-0 truncate text-sm",
              isUnread ? "font-semibold crm-text" : "crm-text",
            )}
          >
            {message.fromName}
          </span>
          <time
            dateTime={message.sentAt}
            className="shrink-0 whitespace-nowrap text-[11px] tabular-nums crm-text-secondary"
          >
            {formatMailTime(message.sentAt)}
          </time>
        </div>

        <p
          className={cn(
            "truncate text-sm",
            isUnread ? "font-medium crm-text" : "crm-text-secondary",
          )}
        >
          {message.subject || (activeFolder === "drafts" ? t("mail.draft.noSubject") : "")}
        </p>

        <p className="line-clamp-1 text-xs leading-snug crm-text-secondary">
          {activeFolder === "drafts" && message.to.length === 0
            ? t("mail.draft.noRecipient")
            : message.preview}
        </p>

        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
          {message.hasAttachment && (
            <Paperclip
              className="h-3.5 w-3.5 shrink-0 crm-text-secondary"
              aria-label="Attachment"
            />
          )}
          {message.deliveryStatus && activeFolder === "sent" && (
            <span className="truncate text-[10px] crm-text-secondary">
              {t(`mail.delivery.${message.deliveryStatus}`)}
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
      </div>
    </button>
  );
}
