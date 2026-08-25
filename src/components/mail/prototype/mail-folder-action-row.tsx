"use client";

import { forwardRef, useRef } from "react";
import { ChevronDown, Plus, Settings } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { useIsProductionMailReadSource } from "@/lib/mail/client/mail-read-source-context";
import { useOptionalMailWorkspace } from "@/lib/mail/client/mail-workspace-context";
import { resolveProductionFolderLabelKey } from "@/lib/mail/client/mail-workspace-ui-adapters";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { folderLabelKey } from "@/lib/mail/prototype/mail-folder-config";
import { MailSendErrorBadge } from "./mail-send-error-badge";
import { MailSettingsPopover } from "./mail-settings-popover";

export const MailFolderActionRow = forwardRef<
  HTMLButtonElement,
  {
    onOpenFolders: () => void;
    onCompose: () => void;
    folderPopoverOpen?: boolean;
    settingsOpen?: boolean;
    onToggleSettings?: () => void;
    onCloseSettings?: () => void;
    showAdminEntry?: boolean;
    onOpenAdminCenter?: () => void;
    settingsButtonRef?: React.RefObject<HTMLButtonElement | null>;
  }
>(function MailFolderActionRow(
  {
    onOpenFolders,
    onCompose,
    folderPopoverOpen,
    settingsOpen = false,
    onToggleSettings,
    onCloseSettings,
    showAdminEntry = false,
    onOpenAdminCenter,
    settingsButtonRef,
  },
  ref,
) {
  const { t } = useTranslation();
  const isProduction = useIsProductionMailReadSource();
  const workspace = useOptionalMailWorkspace();
  const { activeFolder } = useMailPrototype();
  const folderName = isProduction && workspace
    ? t(resolveProductionFolderLabelKey(workspace.selectedFolder))
    : t(folderLabelKey(activeFolder));
  const internalSettingsRef = useRef<HTMLButtonElement>(null);
  const gearRef = settingsButtonRef ?? internalSettingsRef;
  const showSettings = Boolean(onToggleSettings && onCloseSettings);

  return (
    <>
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b crm-border px-3 py-1.5 sm:px-4 sm:py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            ref={ref}
            type="button"
            onClick={onOpenFolders}
            className="mail-folder-trigger flex min-h-11 min-w-0 items-center gap-0.5 rounded-md px-2.5 text-left text-sm font-semibold crm-text transition-colors hover:bg-black/[0.04] active:bg-black/[0.06] dark:hover:bg-white/[0.06] dark:active:bg-white/[0.08]"
            aria-haspopup="menu"
            aria-expanded={folderPopoverOpen}
          >
            <span className="truncate">{folderName}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
          </button>
          <MailSendErrorBadge className="hidden min-[400px]:inline-flex" />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {showSettings ? (
            <button
              ref={gearRef}
              type="button"
              onClick={onToggleSettings}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg crm-text-secondary transition-colors hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
              aria-label={t("mail.settings.title")}
              aria-expanded={settingsOpen}
            >
              <Settings className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCompose}
            className="primary-button flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
            aria-label={t("mail.compose.new")}
            title={t("mail.compose.new")}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
      {showSettings ? (
        <MailSettingsPopover
          open={settingsOpen}
          onClose={onCloseSettings!}
          anchorRef={gearRef}
          showAdminEntry={showAdminEntry}
          onOpenAdminCenter={onOpenAdminCenter}
        />
      ) : null}
    </>
  );
});
