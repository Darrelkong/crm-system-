"use client";

import { useRef } from "react";
import { RefreshCw, Settings } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { MailFolderNav } from "./mail-folder-nav";
import { MailSettingsPopover } from "./mail-settings-popover";

export function MailMailboxesPane({
  onCompose,
  settingsOpen,
  onToggleSettings,
  onCloseSettings,
  onRefresh,
}: {
  onCompose: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onCloseSettings: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const { showToast } = useMailPrototype();
  const settingsRef = useRef<HTMLButtonElement>(null);

  function handleRefresh() {
    onRefresh();
    showToast(t("mail.mailboxes.refreshed"));
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-1 border-b crm-border px-2 py-2">
        <span className="truncate text-xs font-semibold uppercase tracking-wide crm-text-secondary">
          {t("mail.mailboxes.title")}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={handleRefresh}
            className="flex h-8 w-8 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
            aria-label={t("mail.mailboxes.refresh")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            ref={settingsRef}
            type="button"
            onClick={onToggleSettings}
            className="flex h-8 w-8 items-center justify-center rounded-md crm-text-secondary hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
            aria-label={t("mail.settings.title")}
            aria-expanded={settingsOpen}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        <MailFolderNav onCompose={onCompose} />
      </div>
      <MailSettingsPopover
        open={settingsOpen}
        onClose={onCloseSettings}
        anchorRef={settingsRef}
      />
    </div>
  );
}
