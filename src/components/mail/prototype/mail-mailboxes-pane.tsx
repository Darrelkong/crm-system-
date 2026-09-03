"use client";

import { useRef } from "react";
import { RefreshCw, Settings } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import type { MailWorkspaceFolder } from "@/lib/mail/client/mail-read-types";
import { MailFolderNav } from "./mail-folder-nav";
import { MailSettingsPopover } from "./mail-settings-popover";
import { MailApprovalEntryButton } from "@/components/mail/approval/mail-approval-entry-button";

export function MailMailboxesPane({
  onCompose,
  onFolderSelect,
  settingsOpen,
  onToggleSettings,
  onCloseSettings,
  onRefresh,
  showAdminEntry = false,
  onOpenAdminCenter,
  showApprovalEntry = false,
  approvalPendingCount = 0,
  onOpenApprovalCenter,
  showNotificationMailboxEntry = false,
  onOpenNotificationMailbox,
  settingsReturnFocusRef,
  collapsed = false,
  className,
}: {
  onCompose: () => void;
  onFolderSelect?: (folder: MailWorkspaceFolder) => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onCloseSettings: () => void;
  onRefresh: () => void;
  showAdminEntry?: boolean;
  onOpenAdminCenter?: () => void;
  showApprovalEntry?: boolean;
  approvalPendingCount?: number;
  onOpenApprovalCenter?: () => void;
  showNotificationMailboxEntry?: boolean;
  onOpenNotificationMailbox?: () => void;
  settingsReturnFocusRef?: React.RefObject<HTMLButtonElement | null>;
  collapsed?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { showToast } = useMailPrototype();
  const settingsRef = useRef<HTMLButtonElement>(null);
  const gearRef = settingsReturnFocusRef ?? settingsRef;

  function handleRefresh() {
    onRefresh();
    showToast(t("mail.mailboxes.refreshed"));
  }

  if (collapsed) {
    return null;
  }

  return (
    <div
      className={cn(
        "mail-mailbox-sidebar flex h-full min-h-0 min-w-0 flex-col bg-[var(--color-crm-bg)]",
        className,
      )}
    >
      <div className="mail-sidebar-header flex shrink-0 items-center justify-between gap-2 border-b crm-border px-3 py-2.5">
        <span className="truncate text-sm font-semibold crm-text">
          {t("mail.sidebar.title")}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={handleRefresh}
            className="mail-sidebar-icon-btn flex h-8 w-8 items-center justify-center rounded-lg crm-text-secondary"
            aria-label={t("mail.mailboxes.refresh")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          {showApprovalEntry && onOpenApprovalCenter ? (
            <MailApprovalEntryButton
              compact
              pendingCount={approvalPendingCount}
              onClick={onOpenApprovalCenter}
            />
          ) : null}
          <button
            ref={gearRef}
            type="button"
            onClick={onToggleSettings}
            className="mail-sidebar-icon-btn flex h-8 w-8 items-center justify-center rounded-lg crm-text-secondary"
            aria-label={t("mail.settings.title")}
            aria-expanded={settingsOpen}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <MailFolderNav
          onCompose={onCompose}
          onFolderSelect={onFolderSelect}
          showComposeButton
        />
      </div>
      <MailSettingsPopover
        open={settingsOpen}
        onClose={onCloseSettings}
        anchorRef={gearRef}
        showAdminEntry={showAdminEntry}
        onOpenAdminCenter={onOpenAdminCenter}
        showNotificationMailboxEntry={showNotificationMailboxEntry}
        onOpenNotificationMailbox={onOpenNotificationMailbox}
      />
    </div>
  );
}
