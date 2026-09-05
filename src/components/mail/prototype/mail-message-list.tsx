"use client";

import { ArrowUpDown, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useIsProductionMailReadSource } from "@/lib/mail/client/mail-read-source-context";
import { useOptionalMailWorkspace } from "@/lib/mail/client/mail-workspace-context";
import {
  adaptProductionDraftListRow,
  adaptProductionListRow,
  adaptPrototypeListRow,
  filterProductionListRows,
  resolveMailReadErrorMessageKey,
  resolveProductionListEmptyMessageKey,
  resolveProductionListEmptyState,
} from "@/lib/mail/client/mail-workspace-ui-adapters";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { Button } from "@/components/ui/button";
import { MailMessageRow } from "./mail-message-row";
import { MailSendErrorBadge } from "./mail-send-error-badge";
import { MailSharedFilterBar } from "./mail-shared-filter-bar";
import { MailApprovalList } from "@/components/mail/approval/mail-approval-list";
import { MailOutboxList } from "./mail-outbox-list";

export function MailMessageList({
  className,
  onMessageSelect,
  onApprovalItemSelect,
  activeDraftId,
}: {
  className?: string;
  onMessageSelect?: (id: string) => void;
  onApprovalItemSelect?: () => void;
  activeDraftId?: string | null;
}) {
  const { t } = useTranslation();
  const isProduction = useIsProductionMailReadSource();
  const workspace = useOptionalMailWorkspace();
  const {
    filteredMessages,
    selectedId,
    setSelectedId,
    markMessageRead,
    searchQuery,
    setSearchQuery,
    showToast,
  } = useMailPrototype();

  if (isProduction && workspace) {
    const productionWorkspace = workspace;
    if (productionWorkspace.selectedFolder === "outbox") {
      return <MailOutboxList className={className} />;
    }
    if (productionWorkspace.selectedFolder === "pending_approval") {
      return (
        <MailApprovalList
          className={className}
          onItemSelected={onApprovalItemSelect}
        />
      );
    }
    const isDraftsFolder = productionWorkspace.selectedFolder === "drafts";
    const productionRows = isDraftsFolder
      ? productionWorkspace.drafts.map(adaptProductionDraftListRow)
      : productionWorkspace.messages.map(adaptProductionListRow);
    const filteredRows = filterProductionListRows(productionRows, searchQuery);
    const selectedMessageId = productionWorkspace.selectedMessageId;
    const selectedRowId =
      isDraftsFolder && activeDraftId ? activeDraftId : selectedMessageId;
    const emptyState = resolveProductionListEmptyState({
      isLoadingMessages: productionWorkspace.isLoadingMessages,
      loadedRowCount: productionRows.length,
      filteredRowCount: filteredRows.length,
      searchQuery,
      hasError: productionWorkspace.error !== null,
    });
    const showLoadMore =
      productionWorkspace.nextCursor !== null &&
      productionRows.length > 0;
    const isLoadingMore =
      productionWorkspace.isLoadingMessages && productionRows.length > 0;

    function handleProductionSelect(id: string) {
      onMessageSelect?.(id);
    }

    function handleProductionRefresh() {
      if (isDraftsFolder) {
        void productionWorkspace.loadDrafts();
        return;
      }
      void productionWorkspace.refreshMessages();
    }

    function handleLoadMore() {
      void productionWorkspace.loadMoreMessages();
    }

    return (
      <div className={cn("mail-message-list flex min-h-0 min-w-0 flex-col", className)}>
        <div className="mail-list-toolbar shrink-0 border-b crm-border px-3 py-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs font-medium tabular-nums crm-text-secondary">
              {t("mail.list.messageCount", { count: String(filteredRows.length) })}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled
                className="mail-list-toolbar-btn flex h-7 items-center gap-1 rounded-md px-2 text-xs crm-text-secondary opacity-60"
                title={t("mail.list.sortPlaceholder")}
                aria-label={t("mail.list.sortPlaceholder")}
              >
                <ArrowUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="hidden sm:inline">{t("mail.list.sort")}</span>
              </button>
              <button
                type="button"
                onClick={handleProductionRefresh}
                className="mail-list-toolbar-btn flex h-7 w-7 items-center justify-center rounded-md crm-text-secondary"
                aria-label={t("mail.list.refresh")}
                title={t("mail.list.refresh")}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              </button>
              <MailSendErrorBadge />
            </div>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 crm-text-secondary" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => {
                const value = e.target.value;
                setSearchQuery(value);
                void productionWorkspace.setMessageSearchQuery(value);
              }}
              placeholder={t("mail.search.loadedListPlaceholder")}
              className="mail-list-search min-h-8 w-full max-w-full rounded-lg border crm-border bg-[var(--color-crm-bg-muted)] py-1.5 pl-8 pr-3 text-[13px] crm-text"
            />
          </div>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {emptyState ? (
            <p className="px-4 py-8 text-center text-sm crm-text-secondary">
              {emptyState === "error"
                ? t(resolveMailReadErrorMessageKey(productionWorkspace.error!))
                : t(resolveProductionListEmptyMessageKey(emptyState))}
            </p>
          ) : (
            <>
              {filteredRows.map((row) => (
                <MailMessageRow
                  key={row.id}
                  row={row}
                  selected={selectedRowId === row.id}
                  onSelect={() => handleProductionSelect(row.id)}
                  activeFolder={
                    isDraftsFolder
                      ? "drafts"
                      : (productionWorkspace.selectedFolder as "inbox" | "sent" | "trash")
                  }
                  useProductionUnread
                  showSourceMailbox={productionWorkspace.mailboxScope === "all"}
                />
              ))}
              {showLoadMore ? (
                <div className="flex justify-center px-4 py-4">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? t("common.loading") : t("mail.list.loadMore")}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    );
  }

  function handleRefresh() {
    showToast(t("mail.mailboxes.refreshed"));
  }

  return (
    <div className={cn("mail-message-list flex min-h-0 min-w-0 flex-col", className)}>
      <div className="mail-list-toolbar shrink-0 border-b crm-border px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs font-medium tabular-nums crm-text-secondary">
            {t("mail.list.messageCount", { count: String(filteredMessages.length) })}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled
              className="mail-list-toolbar-btn flex h-7 items-center gap-1 rounded-md px-2 text-xs crm-text-secondary opacity-60"
              title={t("mail.list.sortPlaceholder")}
              aria-label={t("mail.list.sortPlaceholder")}
            >
              <ArrowUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="hidden sm:inline">{t("mail.list.sort")}</span>
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              className="mail-list-toolbar-btn flex h-7 w-7 items-center justify-center rounded-md crm-text-secondary"
              aria-label={t("mail.list.refresh")}
              title={t("mail.list.refresh")}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            </button>
            <MailSendErrorBadge />
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 crm-text-secondary" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("mail.search.placeholder")}
            className="mail-list-search min-h-8 w-full max-w-full rounded-lg border crm-border bg-[var(--color-crm-bg-muted)] py-1.5 pl-8 pr-3 text-[13px] crm-text"
          />
        </div>
      </div>
      <MailSharedFilterBar />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {filteredMessages.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm crm-text-secondary">
            {t("mail.list.empty")}
          </p>
        ) : (
          filteredMessages.map((msg) => (
            <MailMessageRow
              key={msg.id}
              row={adaptPrototypeListRow(msg)}
              message={msg}
              selected={selectedId === msg.id}
              onSelect={() => {
                setSelectedId(msg.id);
                markMessageRead(msg.id);
                onMessageSelect?.(msg.id);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
