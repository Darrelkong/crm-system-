"use client";

import { forwardRef } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { folderLabelKey } from "@/lib/mail/prototype/mail-folder-config";
import { MailSendErrorBadge } from "./mail-send-error-badge";

export const MailFolderActionRow = forwardRef<
  HTMLButtonElement,
  {
    onOpenFolders: () => void;
    onCompose: () => void;
    folderPopoverOpen?: boolean;
  }
>(function MailFolderActionRow(
  { onOpenFolders, onCompose, folderPopoverOpen },
  ref,
) {
  const { t } = useTranslation();
  const { activeFolder } = useMailPrototype();
  const folderName = t(folderLabelKey(activeFolder));

  return (
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
  );
});
