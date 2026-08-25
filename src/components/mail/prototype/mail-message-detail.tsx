"use client";

import { MoreHorizontal, PanelLeft } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { formatHongKongDateTime } from "@/lib/timezone";
import { Button } from "@/components/ui/button";
import { MailApprovalPreview } from "./mail-approval-preview";
import { MailMessageActions } from "./mail-message-actions";
import { MailCustomerAssociationPicker } from "./mail-customer-association-picker";
import { MailSharedHandlingPanel } from "./mail-shared-handling-panel";
import { MailInternalNotes } from "./mail-internal-notes";
import { MailActivityTimeline } from "./mail-activity-timeline";
import { MailSharedReplyGuard } from "./mail-shared-reply-guard";
import { MailCrmContextPanel } from "@/components/mail/crm/mail-crm-context-panel";
import { resolveMailMessageCustomerAssociation } from "@/lib/mail/prototype/mail-crm-context-prototype";
import { shouldShowSharedCustomerBadge, isSharedMailboxMessage } from "@/lib/mail/prototype/shared-mailbox";
import { detectSensitiveAttachmentHint } from "@/lib/mail/prototype/sensitivity";
import { useState } from "react";
import type { MailMessage } from "@/lib/mail/prototype/types";

function resolveDisplayCustomer(
  message: MailMessage,
  scenario: ReturnType<typeof useMailPrototype>["scenario"],
) {
  if (!shouldShowSharedCustomerBadge(message, scenario)) return null;
  return message.manualCustomerAssociation ?? message.customerMatch;
}

export function MailMessageDetail({
  onReply,
  onReplyAll,
  onForward,
  onAdminEdit,
  variant = "default",
  messageListCollapsed = false,
  onShowMessageList,
  replyGuard,
  onDismissReplyGuard,
  onProceedReplyGuard,
}: {
  onReply: (messageId: string) => void;
  onReplyAll?: (messageId: string) => void;
  onForward?: (messageId: string) => void;
  onAdminEdit?: (messageId: string) => void;
  variant?: "default" | "desktop";
  messageListCollapsed?: boolean;
  onShowMessageList?: () => void;
  replyGuard?: { messageId: string; action: "reply" | "reply_all" | "forward" } | null;
  onDismissReplyGuard?: () => void;
  onProceedReplyGuard?: () => void;
}) {
  const { t } = useTranslation();
  const {
    messages,
    selectedId,
    isAdminScenario,
    activeFolder,
    mailboxes,
    scenario,
    setMessageCustomerAssociation,
    sharedPermission,
  } = useMailPrototype();
  const [showApproval, setShowApproval] = useState(false);

  const message = messages.find((m) => m.id === selectedId);

  const restoreBar =
    variant === "desktop" && messageListCollapsed && onShowMessageList ? (
      <div className="flex shrink-0 items-center border-b crm-border px-3 py-1.5">
        <button
          type="button"
          onClick={onShowMessageList}
          className="flex min-h-8 items-center gap-1 rounded-md px-1.5 text-sm crm-text-secondary hover:bg-black/[0.03] hover:crm-text dark:hover:bg-white/[0.04]"
          aria-label={t("mail.list.showMessageList")}
        >
          <PanelLeft className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">
            {t("mail.list.showMessageList")}
          </span>
        </button>
      </div>
    ) : null;

  if (!message) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {restoreBar}
        <div className="flex flex-1 items-center justify-center p-8 text-sm crm-text-secondary">
          {t("mail.detail.selectMessage")}
        </div>
      </div>
    );
  }

  const customer = resolveDisplayCustomer(message, scenario);
  const customerAssociation = resolveMailMessageCustomerAssociation(
    message,
    scenario,
  );
  const sharedMailbox = mailboxes.find((m) => m.label === "shared");
  const autoReply = sharedMailbox?.autoReplyEnabled;
  const sensitiveHint = detectSensitiveAttachmentHint(
    message.attachments.map((a) => a.name),
  );

  if (
    showApproval &&
    isAdminScenario &&
    message.folder === "pending_my_approval"
  ) {
    return (
      <div className="flex flex-1 flex-col p-4">
        <MailApprovalPreview
          message={message}
          onClose={() => setShowApproval(false)}
          onEdit={() => {
            setShowApproval(false);
            onAdminEdit?.(message.id);
          }}
        />
      </div>
    );
  }

  return (
    <article className="flex flex-1 flex-col overflow-hidden">
      {restoreBar}
      <header className="mail-reading-header border-b crm-border px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start gap-2">
          <h2 className="min-w-0 flex-1 text-lg font-semibold crm-text">
            {message.subject}
          </h2>
          {message.isImportant && (
            <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
              {t("mail.flag.important")}
            </span>
          )}
          {message.sensitivity && message.sensitivity !== "normal" && (
            <span className="rounded-md bg-neutral-500/10 px-2 py-0.5 text-xs crm-text-secondary">
              {t(`mail.sensitivity.${message.sensitivity}`)}
            </span>
          )}
        </div>
        <div className="mt-3 space-y-1 text-sm">
          <p className="crm-text">
            <span className="font-medium">{message.fromName}</span>
            <span className="crm-text-secondary">
              {" "}
              &lt;{message.fromEmail}&gt;
            </span>
          </p>
          <p className="crm-text-secondary">
            {t("mail.detail.to")}: {message.to.join(", ")}
          </p>
          <p className="text-xs crm-text-secondary">
            {formatHongKongDateTime(message.sentAt)} · {message.mailbox}
          </p>
          {customer && (
            <p className="inline-flex rounded-lg bg-blue-500/10 px-2 py-1 text-xs text-blue-700 dark:text-blue-300">
              {t("mail.association.badge", { name: customer.name })}
            </p>
          )}
          <MailCustomerAssociationPicker
            value={message.manualCustomerAssociation ?? customer}
            onChange={(next) =>
              setMessageCustomerAssociation(message.id, next)
            }
            compact
          />
          {message.deliveryStatus && activeFolder === "sent" && (
            <DeliveryBlock message={message} />
          )}
          {sharedMailbox && message.mailbox === sharedMailbox.address && (
            <p
              className="text-xs crm-text-secondary"
              title={t("mail.autoReply.tooltip")}
            >
              {autoReply
                ? t("mail.autoReply.enabled")
                : t("mail.autoReply.disabled")}
            </p>
          )}
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div
          className={
            variant === "desktop" ? "mail-reading-body mx-auto max-w-[52rem]" : ""
          }
        >
          <p className="whitespace-pre-wrap text-sm leading-relaxed crm-text">
            {message.body}
          </p>
          {message.attachments.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide crm-text-secondary">
                {t("mail.detail.attachments")}
              </p>
              {sensitiveHint && (
                <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">
                  {t("mail.sensitivity.attachmentHint")}
                </p>
              )}
              <ul className="mail-attachment-list divide-y crm-border">
                {message.attachments.map((a) => (
                  <li
                    key={a.id}
                    className="mail-attachment-row flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                  >
                    <span className="min-w-0 truncate crm-text">{a.name}</span>
                    <span className="shrink-0 text-xs crm-text-secondary">
                      {a.sizeLabel}
                      {a.kind === "secure_file" &&
                        ` · ${t("mail.attachment.secureFile")}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {message.returnReason && (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
              <p className="font-medium crm-text">
                {t("mail.detail.returnReason")}
              </p>
              <p className="crm-text-secondary">{message.returnReason}</p>
            </div>
          )}
        </div>
      </div>
      <MailCrmContextPanel
        customerAssociation={customerAssociation}
        variant={variant === "desktop" ? "desktop" : "mobile"}
      />
      {isSharedMailboxMessage(message) && (
        <>
          <MailSharedHandlingPanel
            message={message}
            compact={variant !== "desktop"}
          />
          <MailInternalNotes
            message={message}
            compact={variant !== "desktop"}
          />
          <MailActivityTimeline
            message={message}
            compact={variant !== "desktop"}
          />
        </>
      )}
      <footer className="mail-reading-footer flex flex-col gap-2 border-t crm-border px-4 py-3 sm:px-6">
        {replyGuard?.messageId === message.id && onDismissReplyGuard && onProceedReplyGuard && (
          <MailSharedReplyGuard
            message={message}
            onCancel={onDismissReplyGuard}
            onProceed={onProceedReplyGuard}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
        {isAdminScenario && activeFolder === "pending_my_approval" ? (
          <Button type="button" onClick={() => setShowApproval(true)}>
            {t("mail.approval.review")}
          </Button>
        ) : isSharedMailboxMessage(message) && !sharedPermission.canReply ? (
          <span className="text-sm crm-text-secondary">
            {t("mail.shared.readOnlyHint")}
          </span>
        ) : (
          <MailMessageActions
            message={message}
            variant={variant === "desktop" ? "desktop" : "mobile"}
            onReply={() => onReply(message.id)}
            onReplyAll={() => onReplyAll?.(message.id)}
            onForward={() => onForward?.(message.id)}
            disabled={!sharedPermission.canReply}
          />
        )}
        </div>
      </footer>
    </article>
  );
}

function DeliveryBlock({ message }: { message: MailMessage }) {
  const { t } = useTranslation();
  const status = message.deliveryStatus!;
  const isError = status === "bounced" || status === "failed";

  return (
    <div
      className={
        isError
          ? "mt-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-xs"
          : "mt-1 text-xs crm-text-secondary"
      }
    >
      <p className="font-medium crm-text">{t(`mail.delivery.${status}`)}</p>
      {message.deliveryDetail && (
        <p className="crm-text-secondary">{message.deliveryDetail}</p>
      )}
      {isError && (
        <button type="button" className="mt-1 text-xs link-primary">
          {t("mail.delivery.viewError")}
        </button>
      )}
    </div>
  );
}
