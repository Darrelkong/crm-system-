"use client";

import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useIsProductionMailReadSource } from "@/lib/mail/client/mail-read-source-context";
import { useOptionalMailWorkspace } from "@/lib/mail/client/mail-workspace-context";
import {
  adaptAccessibleMailbox,
  PRODUCTION_MAIL_READ_FOLDERS,
  PRODUCTION_WORKFLOW_FOLDERS,
} from "@/lib/mail/client/mail-workspace-ui-adapters";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { visibleMailFolders } from "@/lib/mail/prototype/mail-folder-config";
import { Button } from "@/components/ui/button";
import { Inbox, Plus, Users } from "lucide-react";

export function MailFolderNav({
  onCompose,
  className,
  showComposeButton = true,
}: {
  onCompose: () => void;
  className?: string;
  showComposeButton?: boolean;
}) {
  const { t } = useTranslation();
  const isProduction = useIsProductionMailReadSource();
  const workspace = useOptionalMailWorkspace();
  const {
    activeFolder,
    setActiveFolder,
    folderCounts,
    isAdminScenario,
    setSelectedId,
    mailboxes,
    activeMailbox,
    setActiveMailbox,
  } = useMailPrototype();

  if (isProduction && workspace) {
    const productionMailboxes = workspace.mailboxes.map(adaptAccessibleMailbox);
    const personalMailboxes = productionMailboxes.filter(
      (mailbox) => mailbox.mailboxType === "personal",
    );
    const sharedMailboxes = productionMailboxes.filter(
      (mailbox) => mailbox.mailboxType === "shared",
    );

    function ProductionFolderButton({
      folder,
    }: {
      folder:
        | (typeof PRODUCTION_MAIL_READ_FOLDERS)[number]
        | (typeof PRODUCTION_WORKFLOW_FOLDERS)[number];
    }) {
      const active = workspace!.selectedFolder === folder.id;
      return (
        <button
          type="button"
          onClick={() => {
            void workspace!.selectFolder(folder.id);
          }}
          className={cn(
            "mail-sidebar-folder flex min-h-9 w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
            active ? "mail-nav-active" : "mail-nav-item",
          )}
        >
          <span className="truncate">{t(folder.labelKey)}</span>
        </button>
      );
    }

    function ProductionMailboxButton({
      mailboxId,
      label,
      icon: Icon,
    }: {
      mailboxId: string;
      label: string;
      icon: typeof Inbox;
    }) {
      const active = workspace!.selectedMailboxId === mailboxId;
      return (
        <button
          type="button"
          onClick={() => {
            void workspace!.selectMailbox(mailboxId);
          }}
          className={cn(
            "mail-sidebar-folder flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
            active ? "mail-nav-active" : "mail-nav-item",
          )}
        >
          <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </button>
      );
    }

    return (
      <aside className={cn("flex flex-col gap-3", className)}>
        {showComposeButton && (
          <Button
            type="button"
            size="sm"
            className="mail-compose-button h-10 w-full justify-center gap-2 rounded-xl shadow-sm"
            onClick={onCompose}
          >
            <Plus className="h-4 w-4" />
            {t("mail.compose.new")}
          </Button>
        )}

        <div className="mail-sidebar-section">
          <p className="mail-sidebar-section-label mb-1.5 px-2.5">
            {t("mail.sidebar.folders")}
          </p>
          <nav className="space-y-0.5" aria-label={t("mail.sidebar.folders")}>
            {PRODUCTION_MAIL_READ_FOLDERS.map((folder) => (
              <ProductionFolderButton key={folder.id} folder={folder} />
            ))}
            {PRODUCTION_WORKFLOW_FOLDERS.map((folder) => (
              <ProductionFolderButton key={folder.id} folder={folder} />
            ))}
          </nav>
        </div>

        {(personalMailboxes.length > 0 || sharedMailboxes.length > 0) && (
          <div className="mail-sidebar-section">
            <p className="mail-sidebar-section-label mb-1.5 px-2.5">
              {t("mail.sidebar.sharedMailboxes")}
            </p>
            <nav
              className="space-y-0.5"
              aria-label={t("mail.sidebar.sharedMailboxes")}
            >
              {personalMailboxes.map((box) => (
                <ProductionMailboxButton
                  key={box.id}
                  mailboxId={box.id}
                  label={box.displayName ?? t("mail.mailbox.personal")}
                  icon={Inbox}
                />
              ))}
              {sharedMailboxes.map((box) => (
                <ProductionMailboxButton
                  key={box.id}
                  mailboxId={box.id}
                  label={box.displayName ?? t("mail.mailbox.shared")}
                  icon={Users}
                />
              ))}
            </nav>
          </div>
        )}
      </aside>
    );
  }

  const folders = visibleMailFolders(isAdminScenario);
  const mailFolders = folders.filter((f) => f.section === "mail");
  const adminFolders = folders.filter((f) => f.section === "admin");
  const sharedMailboxes = mailboxes.filter((m) => m.label === "shared");
  const personalMailboxes = mailboxes.filter((m) => m.label === "personal");

  function FolderButton({
    id,
    labelKey,
  }: {
    id: (typeof folders)[number]["id"];
    labelKey: string;
  }) {
    const count = folderCounts[id];
    const active = activeFolder === id;
    return (
      <button
        type="button"
        onClick={() => {
          setActiveFolder(id);
          setSelectedId(null);
        }}
        className={cn(
          "mail-sidebar-folder flex min-h-9 w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
          active ? "mail-nav-active" : "mail-nav-item",
        )}
      >
        <span className="truncate">{t(labelKey)}</span>
        {count > 0 && (
          <span
            className={cn(
              "mail-folder-count ml-2 shrink-0 text-xs tabular-nums",
              active ? "opacity-90" : "crm-text-secondary",
            )}
          >
            {count}
          </span>
        )}
      </button>
    );
  }

  function MailboxButton({
    address,
    label,
    icon: Icon,
  }: {
    address: string;
    label: string;
    icon: typeof Inbox;
  }) {
    const active = activeMailbox === address;
    return (
      <button
        type="button"
        onClick={() => {
          setActiveMailbox(address);
          setActiveFolder("inbox");
          setSelectedId(null);
        }}
        className={cn(
          "mail-sidebar-folder flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
          active ? "mail-nav-active" : "mail-nav-item",
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    );
  }

  return (
    <aside className={cn("flex flex-col gap-3", className)}>
      {showComposeButton && (
        <Button
          type="button"
          size="sm"
          className="mail-compose-button h-10 w-full justify-center gap-2 rounded-xl shadow-sm"
          onClick={onCompose}
        >
          <Plus className="h-4 w-4" />
          {t("mail.compose.new")}
        </Button>
      )}

      <div className="mail-sidebar-section">
        <p className="mail-sidebar-section-label mb-1.5 px-2.5">
          {t("mail.sidebar.folders")}
        </p>
        <nav className="space-y-0.5" aria-label={t("mail.sidebar.folders")}>
          {mailFolders.map((folder) => (
            <FolderButton
              key={folder.id}
              id={folder.id}
              labelKey={folder.labelKey}
            />
          ))}
        </nav>
      </div>

      {(personalMailboxes.length > 0 || sharedMailboxes.length > 0) && (
        <div className="mail-sidebar-section">
          <p className="mail-sidebar-section-label mb-1.5 px-2.5">
            {t("mail.sidebar.sharedMailboxes")}
          </p>
          <nav className="space-y-0.5" aria-label={t("mail.sidebar.sharedMailboxes")}>
            {personalMailboxes.map((box) => (
              <MailboxButton
                key={box.address}
                address={box.address}
                label={box.displayName ?? t("mail.mailbox.personal")}
                icon={Inbox}
              />
            ))}
            {sharedMailboxes.map((box) => (
              <MailboxButton
                key={box.address}
                address={box.address}
                label={box.displayName ?? t("mail.mailbox.shared")}
                icon={Users}
              />
            ))}
          </nav>
        </div>
      )}

      {adminFolders.length > 0 && (
        <div className="mail-sidebar-section">
          <p className="mail-sidebar-section-label mb-1.5 px-2.5">
            {t("mail.folderSheet.adminSection")}
          </p>
          <nav className="space-y-0.5" aria-label={t("mail.folderSheet.adminSection")}>
            {adminFolders.map((folder) => (
              <FolderButton
                key={folder.id}
                id={folder.id}
                labelKey={folder.labelKey}
              />
            ))}
          </nav>
        </div>
      )}
    </aside>
  );
}
