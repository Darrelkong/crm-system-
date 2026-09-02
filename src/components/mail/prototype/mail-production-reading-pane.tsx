"use client";

import { PanelLeft } from "lucide-react";
import { useState } from "react";
import { MailAttachmentViewer } from "@/components/mail/mail-attachment-viewer";
import { MailCrmContextPanel } from "@/components/mail/crm/mail-crm-context-panel";
import { useTranslation } from "@/i18n/provider";
import { formatHongKongDateTime } from "@/lib/timezone";
import {
  adaptProductionCustomerAssociation,
  adaptProductionDetailView,
  canRenderProductionQuotedHtml,
  isProductionDetailReady,
  resolveMailReadErrorMessageKey,
  shouldRenderProductionCrmContextPanel,
  isProductionMailReadFolder,
  type MailDetailPresentation,
} from "@/lib/mail/client/mail-workspace-ui-adapters";
import type { MailReadFolder } from "@/lib/mail/client/mail-read-types";
import { buildProductionAttachmentRowPresentation } from "@/lib/mail/client/mail-attachment-download-ui";
import type { MailCrmContextAssociation } from "@/lib/mail/crm/mail-crm-context-model";
import { useOptionalMailWorkspace } from "@/lib/mail/client/mail-workspace-context";
import { MailProductionMessageActions } from "./mail-production-message-actions";
import type { ProductionComposeSeedAction } from "./mail-production-message-actions";

function ProductionDetailBody({
  detail,
  folder,
  variant,
}: {
  detail: MailDetailPresentation;
  folder: MailReadFolder;
  variant: "default" | "desktop";
}) {
  const { t } = useTranslation();
  const [previewAttachment, setPreviewAttachment] = useState<
    MailDetailPresentation["attachments"][number] | null
  >(null);
  const bodyClassName =
    variant === "desktop" ? "mail-reading-body mx-auto max-w-[52rem]" : "mail-reading-body";

  return (
    <div className={bodyClassName}>
      {detail.bodyHtml?.trim() ? (
        <div
          className="text-sm leading-relaxed crm-text"
          dangerouslySetInnerHTML={{ __html: detail.bodyHtml }}
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-relaxed crm-text">
          {detail.bodyText}
        </p>
      )}

      {(canRenderProductionQuotedHtml(detail.quotedHtml) ||
        detail.quotedText?.trim()) && (
        <div className="mt-6 border-l-2 crm-border pl-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide crm-text-secondary">
            {t("mail.compose.showQuoted")}
          </p>
          {canRenderProductionQuotedHtml(detail.quotedHtml) ? (
            <div
              className="text-sm leading-relaxed crm-text-secondary"
              dangerouslySetInnerHTML={{ __html: detail.quotedHtml! }}
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed crm-text-secondary">
              {detail.quotedText}
            </p>
          )}
        </div>
      )}

      {detail.attachments.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide crm-text-secondary">
            {t("mail.detail.attachments")}
          </p>
          <ul className="mail-attachment-list divide-y crm-border">
            {detail.attachments.map((attachment) => {
              const row = buildProductionAttachmentRowPresentation({
                attachment,
                folder,
              });
              return (
                <li
                  key={attachment.id}
                  className="mail-attachment-row flex min-w-0 items-center justify-between gap-3 px-3 py-2.5 text-sm"
                >
                  {row.previewable && row.previewHref ? (
                    <button
                      type="button"
                      onClick={() => setPreviewAttachment(attachment)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left crm-text hover:underline"
                      aria-label={`${t("mail.attachment.preview")} ${row.filename}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{row.filename}</span>
                      <span className="shrink-0 whitespace-nowrap text-xs crm-text-secondary">
                        {row.sizeLabel}
                      </span>
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 truncate crm-text">
                      {row.filename}
                    </span>
                  )}
                  <div className="flex shrink-0 items-center gap-2 text-xs crm-text-secondary">
                    {!row.previewable ? (
                      <span className="whitespace-nowrap">
                        {row.sizeLabel}
                        {row.showSecureFileLabel &&
                          ` · ${t("mail.attachment.secureFile")}`}
                      </span>
                    ) : null}
                    {row.previewable && row.previewHref ? (
                      <span className="hidden whitespace-nowrap sm:inline">
                        {t("mail.attachment.preview")}
                      </span>
                    ) : null}
                    {row.downloadAvailable && row.downloadHref ? (
                      <a
                        href={row.downloadHref}
                        className="rounded-md px-2 py-1 font-medium crm-text hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                        aria-label={`${t("common.download")} ${row.filename}`}
                      >
                        {t("common.download")}
                      </a>
                    ) : (
                      <span
                        className="rounded-md px-2 py-1 crm-text-secondary"
                        aria-disabled="true"
                      >
                        {t("mail.attachment.unavailable")}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {previewAttachment ? (
            (() => {
              const previewRow = buildProductionAttachmentRowPresentation({
                attachment: previewAttachment,
                folder,
              });
              if (
                !previewRow.previewable ||
                !previewRow.previewHref ||
                !previewRow.previewType
              ) {
                return null;
              }
              return (
                <MailAttachmentViewer
                  key={previewAttachment.id}
                  filename={previewRow.filename}
                  sizeBytes={previewAttachment.sizeBytes}
                  previewType={previewRow.previewType}
                  previewHref={previewRow.previewHref}
                  downloadHref={previewRow.downloadHref}
                  onClose={() => setPreviewAttachment(null)}
                />
              );
            })()
          ) : null}
        </div>
      )}
    </div>
  );
}

function ProductionDetailContent({
  detail,
  customerAssociation,
  folder,
  variant,
  messageId,
  onSeedAction,
  composeSeedPending = false,
}: {
  detail: MailDetailPresentation;
  customerAssociation: MailCrmContextAssociation | null;
  folder: MailReadFolder;
  variant: "default" | "desktop";
  messageId: string;
  onSeedAction?: (messageId: string, mode: ProductionComposeSeedAction) => void;
  composeSeedPending?: boolean;
}) {
  const { t } = useTranslation();
  const showSenderAddress =
    detail.senderName.trim().toLowerCase() !== detail.senderAddress.trim().toLowerCase();

  return (
    <article className="flex flex-1 flex-col overflow-hidden">
      <header className="mail-reading-header border-b crm-border px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start gap-2">
          <h2 className="min-w-0 flex-1 text-lg font-semibold crm-text">
            {detail.subject}
          </h2>
          {detail.isImportant && (
            <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
              {t("mail.flag.important")}
            </span>
          )}
        </div>
        <div className="mt-3 space-y-1 text-sm">
          <p className="crm-text">
            <span className="font-medium">{detail.senderName}</span>
            {showSenderAddress && (
              <span className="crm-text-secondary">
                {" "}
                &lt;{detail.senderAddress}&gt;
              </span>
            )}
          </p>
          {detail.recipientLines.map((group) => (
            <p key={group.type} className="crm-text-secondary">
              {t(`mail.compose.${group.type}`)}: {group.addresses.join(", ")}
            </p>
          ))}
          {detail.timestamp && (
            <p className="text-xs crm-text-secondary">
              {formatHongKongDateTime(detail.timestamp)}
            </p>
          )}
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <ProductionDetailBody detail={detail} folder={folder} variant={variant} />
      </div>
      {customerAssociation ? (
        <MailCrmContextPanel
          customerAssociation={customerAssociation}
          variant={variant === "desktop" ? "desktop" : "mobile"}
        />
      ) : null}
      <footer className="mail-reading-footer border-t crm-border px-4 py-3 sm:px-6">
        {onSeedAction ? (
          <MailProductionMessageActions
            messageId={messageId}
            onSeedAction={onSeedAction}
            pending={composeSeedPending}
            variant={variant === "desktop" ? "desktop" : "mobile"}
          />
        ) : (
          <p className="text-sm crm-text-secondary">{t("mail.compose.sendDisabled")}</p>
        )}
      </footer>
    </article>
  );
}

export function MailProductionReadingPane({
  variant = "default",
  messageListCollapsed = false,
  onShowMessageList,
  onSeedAction,
  composeSeedPending = false,
}: {
  variant?: "default" | "desktop";
  messageListCollapsed?: boolean;
  onShowMessageList?: () => void;
  onSeedAction?: (messageId: string, mode: ProductionComposeSeedAction) => void;
  composeSeedPending?: boolean;
}) {
  const { t } = useTranslation();
  const workspace = useOptionalMailWorkspace();

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

  if (!workspace) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {restoreBar}
        <div className="flex flex-1 items-center justify-center p-8 text-sm crm-text-secondary">
          {t("mail.detail.selectMessage")}
        </div>
      </div>
    );
  }

  const {
    selectedMessageId,
    selectedMessage,
    selectedFolder,
    isLoadingDetail,
    error,
  } = workspace;

  if (!selectedMessageId) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {restoreBar}
        <div className="flex flex-1 items-center justify-center p-8 text-sm crm-text-secondary">
          {t("mail.detail.selectMessage")}
        </div>
      </div>
    );
  }

  if (isLoadingDetail) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {restoreBar}
        <div className="flex flex-1 items-center justify-center p-8 text-sm crm-text-secondary">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  if (
    error &&
    (!selectedMessage || selectedMessage.id !== selectedMessageId)
  ) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {restoreBar}
        <div className="flex flex-1 items-center justify-center p-8 text-sm crm-text-secondary">
          {t(resolveMailReadErrorMessageKey(error))}
        </div>
      </div>
    );
  }

  const detailState = {
    selectedMessageId,
    selectedMessage,
    isLoadingDetail,
  };

  if (!isProductionDetailReady(detailState)) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {restoreBar}
        <div className="flex flex-1 items-center justify-center p-8 text-sm crm-text-secondary">
          {t("common.loadFailed")}
        </div>
      </div>
    );
  }

  const detail = adaptProductionDetailView(detailState.selectedMessage);
  const customerAssociation = shouldRenderProductionCrmContextPanel(
    detailState.selectedMessage.customerAssociation,
  )
    ? adaptProductionCustomerAssociation(
        detailState.selectedMessage.customerAssociation,
      )
    : null;
  const messageFolder = isProductionMailReadFolder(selectedFolder)
    ? selectedFolder
    : "inbox";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {restoreBar}
      <ProductionDetailContent
        detail={detail}
        customerAssociation={customerAssociation}
        folder={messageFolder}
        variant={variant}
        messageId={selectedMessageId}
        onSeedAction={onSeedAction}
        composeSeedPending={composeSeedPending}
      />
    </div>
  );
}
