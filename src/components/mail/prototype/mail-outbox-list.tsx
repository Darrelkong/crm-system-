"use client";

import { CircleAlert, Clock3, Paperclip, RefreshCw, Send } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useOptionalMailWorkspace } from "@/lib/mail/client/mail-workspace-context";
import {
  resolveOutboxStatusLabelKey,
  type MailOutboxListItem,
} from "@/lib/mail/client/mail-outbox";
import { formatHongKongDateTime } from "@/lib/timezone";

function OutboxStatus({
  item,
}: {
  item: MailOutboxListItem;
}) {
  const { t } = useTranslation();
  const Icon =
    item.status === "failed"
      ? CircleAlert
      : item.status === "dispatch_uncertain"
        ? CircleAlert
        : item.status === "processing"
          ? Send
          : Clock3;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        item.status === "failed"
          ? "text-red-600 dark:text-red-400"
          : item.status === "dispatch_uncertain"
            ? "text-amber-700 dark:text-amber-300"
            : "crm-text-secondary",
      )}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          item.status === "processing" && "animate-pulse motion-reduce:animate-none",
        )}
        aria-hidden
      />
      {t(resolveOutboxStatusLabelKey(item.status))}
    </span>
  );
}

function OutboxRow({ item }: { item: MailOutboxListItem }) {
  const { t } = useTranslation();
  const primaryRecipient =
    item.recipients.find((recipient) => recipient.recipientType === "to") ??
    item.recipients[0];
  const recipientLabel = primaryRecipient?.address ?? "—";
  const extraRecipientCount = Math.max(0, item.totalRecipientCount - 1);

  return (
    <div className="mail-outbox-row border-b crm-border px-3 py-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium crm-text">{item.subject}</p>
          <p className="mt-1 truncate text-xs crm-text-secondary">
            {recipientLabel}
            {extraRecipientCount > 0 ? ` +${extraRecipientCount}` : ""}
          </p>
        </div>
        {item.hasAttachments ? (
          <Paperclip
            className="mt-0.5 h-3.5 w-3.5 shrink-0 crm-text-secondary"
            aria-label={t("mail.outbox.attachments", {
              count: String(item.attachmentCount),
            })}
          />
        ) : null}
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <OutboxStatus item={item} />
        <span className="text-xs crm-text-secondary">·</span>
        <span className="text-xs crm-text-secondary">
          {formatHongKongDateTime(item.createdAt)}
        </span>
      </div>
    </div>
  );
}

export function MailOutboxList({ className }: { className?: string }) {
  const { t } = useTranslation();
  const workspace = useOptionalMailWorkspace();

  if (!workspace) {
    return null;
  }

  return (
    <div className={cn("mail-outbox-list flex min-h-0 min-w-0 flex-col", className)}>
      <div className="mail-list-toolbar flex shrink-0 items-center justify-between border-b crm-border px-3 py-2">
        <p className="text-xs font-medium crm-text-secondary">
          {t("mail.outbox.title")}
        </p>
        <button
          type="button"
          onClick={() => void workspace.refreshOutbox()}
          disabled={workspace.isLoadingOutbox}
          className="mail-list-toolbar-btn flex h-7 w-7 items-center justify-center rounded-md crm-text-secondary"
          aria-label={t("mail.list.refresh")}
          title={t("mail.list.refresh")}
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", workspace.isLoadingOutbox && "animate-spin motion-reduce:animate-none")}
            aria-hidden
          />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {workspace.outboxError ? (
          <p className="px-3 py-6 text-sm text-red-600 dark:text-red-400">
            {t("common.loadFailed")}
          </p>
        ) : null}
        {workspace.isLoadingOutbox && workspace.outboxItems.length === 0 ? (
          <p className="px-3 py-6 text-sm crm-text-secondary">
            {t("common.loading")}
          </p>
        ) : null}
        {!workspace.isLoadingOutbox &&
        !workspace.outboxError &&
        workspace.outboxItems.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm crm-text-secondary">
            {t("mail.outbox.empty")}
          </p>
        ) : null}
        {workspace.outboxItems.map((item) => (
          <OutboxRow key={item.sendOperationId} item={item} />
        ))}
      </div>
    </div>
  );
}
