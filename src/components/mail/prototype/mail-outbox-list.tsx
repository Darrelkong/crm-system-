"use client";

import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Paperclip,
  RefreshCw,
  Send,
  ShieldOff,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useOptionalMailWorkspace } from "@/lib/mail/client/mail-workspace-context";
import {
  acknowledgeOperationalSend,
  fetchOperationalSend,
  revokeOperationalLargeAttachmentCapabilities,
  resolveOutboxStatusLabelKey,
  type LargeAttachmentOperationalSendView,
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
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] =
    useState<LargeAttachmentOperationalSendView | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState(false);
  const primaryRecipient =
    item.recipients.find((recipient) => recipient.recipientType === "to") ??
    item.recipients[0];
  const recipientLabel = primaryRecipient?.address ?? "—";
  const extraRecipientCount = Math.max(0, item.totalRecipientCount - 1);

  async function toggleOperationalDetail() {
    if (!item.operationalDetailAvailable) return;
    setExpanded((current) => !current);
    if (detail) return;
    setLoadingDetail(true);
    try {
      setDetail(await fetchOperationalSend(item.sendOperationId));
    } catch {
      setActionError(true);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function acknowledge() {
    setActionPending(true);
    setActionError(false);
    try {
      await acknowledgeOperationalSend(item.sendOperationId);
    } catch {
      setActionError(true);
    } finally {
      setActionPending(false);
    }
  }

  async function revokeCapabilities() {
    if (!window.confirm(t("mail.outbox.confirmRevoke"))) return;
    setActionPending(true);
    setActionError(false);
    try {
      await revokeOperationalLargeAttachmentCapabilities(item.sendOperationId);
      setDetail(await fetchOperationalSend(item.sendOperationId));
    } catch {
      setActionError(true);
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div className="mail-outbox-row border-b crm-border px-3 py-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium crm-text">{item.subject}</p>
          {item.sourceMailbox ? (
            <p className="mt-0.5 truncate text-[11px] crm-text-secondary">
              {item.sourceMailbox.displayName ?? item.sourceMailbox.address}
              {item.sourceMailbox.mailboxType === "shared"
                ? ` · ${t("mail.mailbox.shared")}`
                : ""}
            </p>
          ) : null}
          <p className="mt-1 truncate text-xs crm-text-secondary">
            {recipientLabel}
            {extraRecipientCount > 0 ? ` +${extraRecipientCount}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.hasAttachments ? (
            <Paperclip
              className="mt-0.5 h-3.5 w-3.5 crm-text-secondary"
              aria-label={t("mail.outbox.attachments", {
                count: String(item.attachmentCount),
              })}
            />
          ) : null}
          {item.operationalDetailAvailable ? (
            <button
              type="button"
              onClick={() => void toggleOperationalDetail()}
              className="rounded p-1 crm-text-secondary"
              aria-expanded={expanded}
              aria-label={t("mail.outbox.viewDetails")}
              title={t("mail.outbox.viewDetails")}
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4" aria-hidden />
              )}
            </button>
          ) : null}
        </div>
      </div>
      {item.operationalDetailAvailable && expanded ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-medium">{t("mail.outbox.manualConfirmation")}</p>
          <p className="mt-1">{t("mail.outbox.uncertainHint")}</p>
          {loadingDetail ? (
            <p className="mt-2">{t("common.loading")}</p>
          ) : detail ? (
            <div className="mt-3 space-y-2">
              <p className="break-all">
                {t("mail.outbox.sendOperationId")}: {detail.sendOperationId}
              </p>
              <p>
                {t("mail.outbox.attemptTime")}:{" "}
                {formatHongKongDateTime(
                  detail.attempt?.startedAt ?? detail.createdAt,
                )}
              </p>
              <p>
                {t("mail.outbox.createdAt")}:{" "}
                {formatHongKongDateTime(detail.createdAt)}
              </p>
              <p>
                {t("mail.outbox.completedAt")}:{" "}
                {detail.completedAt
                  ? formatHongKongDateTime(detail.completedAt)
                  : "—"}
              </p>
              <p>
                {t("mail.outbox.providerMessageId")}:{" "}
                {detail.attempt?.providerMessageId ?? "—"}
              </p>
              <p>
                {t("mail.outbox.largeAttachment")}:{" "}
                {detail.largeAttachment.involved
                  ? t("common.yes")
                  : t("common.no")}
              </p>
              {detail.largeAttachment.capabilityStates.map((capability) => (
                <p key={capability.deliveryTokenId}>
                  {t("mail.outbox.capabilityState")}: {capability.state} ·{" "}
                  {formatHongKongDateTime(capability.expiresAt)}
                </p>
              ))}
              {detail.attempt?.errorMessage ? (
                <p className="break-words">
                  {t("mail.outbox.lastTransportError")}:{" "}
                  {detail.attempt.errorMessage}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void acknowledge()}
                  disabled={actionPending}
                  className="rounded border border-amber-300 px-2 py-1 font-medium disabled:opacity-50"
                >
                  {t("mail.outbox.markManual")}
                </button>
                {detail.largeAttachment.capabilityStates.some((capability) =>
                  ["armed", "confirmed"].includes(capability.state),
                ) ? (
                  <button
                    type="button"
                    onClick={() => void revokeCapabilities()}
                    disabled={actionPending}
                    className="inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 font-medium text-red-700 disabled:opacity-50 dark:text-red-300"
                  >
                    <ShieldOff className="h-3.5 w-3.5" aria-hidden />
                    {t("mail.outbox.revokeCapability")}
                  </button>
                ) : null}
              </div>
              {actionError ? (
                <p className="text-red-700 dark:text-red-300">
                  {t("common.actionFailed")}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
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
        {workspace.outboxNextCursor ? (
          <div className="flex justify-center px-4 py-4">
            <button
              type="button"
              onClick={() => void workspace.loadMoreOutbox()}
              disabled={workspace.isLoadingOutbox}
              className="rounded-md border crm-border px-3 py-1.5 text-xs crm-text-secondary"
            >
              {workspace.isLoadingOutbox
                ? t("common.loading")
                : t("mail.list.loadMore")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
