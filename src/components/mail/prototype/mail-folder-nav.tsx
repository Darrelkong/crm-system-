"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import { canReviewApprovals } from "@/lib/mail/client/approval-workflow-management";
import { useOptionalMailApprovalWorkspace } from "@/lib/mail/client/mail-approval-workspace-context";
import { useIsProductionMailReadSource } from "@/lib/mail/client/mail-read-source-context";
import {
  useMailWorkspace,
  useOptionalMailWorkspace,
} from "@/lib/mail/client/mail-workspace-context";
import type { MailWorkspaceFolder } from "@/lib/mail/client/mail-read-types";
import {
  adaptAccessibleMailbox,
  adaptPrototypeSidebarMailbox,
  filterVisibleWorkflowFolders,
  isProductionMailReadFolder,
  PRODUCTION_MAIL_READ_FOLDERS,
  resolveMailboxSidebarSections,
  resolveWorkflowFolderLabelKey,
} from "@/lib/mail/client/mail-workspace-ui-adapters";
import {
  mailboxSidebarPageForSelection,
  paginateSidebarMailboxes,
} from "@/lib/mail/client/mail-sidebar-mailbox-pagination";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { visibleMailFolders } from "@/lib/mail/prototype/mail-folder-config";
import { Button } from "@/components/ui/button";
import { Inbox, Plus, Users } from "lucide-react";
import { MailSidebarMailboxPager } from "./mail-sidebar-mailbox-pager";

type PaginatedMailboxRow = {
  id: string;
  label: string;
  icon: typeof Inbox;
};

function usePaginatedMailboxRows(
  rows: PaginatedMailboxRow[],
  selectedId: string | null | undefined,
) {
  const [mailboxPage, setMailboxPage] = useState(0);
  const pagination = paginateSidebarMailboxes(rows, mailboxPage);

  useEffect(() => {
    setMailboxPage(
      mailboxSidebarPageForSelection(rows, selectedId, (row) => row.id),
    );
  }, [rows, selectedId]);

  return {
    pagination,
    setMailboxPage,
  };
}

function PaginatedMailboxNav({
  rows,
  selectedId,
  onSelect,
  ariaLabel,
}: {
  rows: PaginatedMailboxRow[];
  selectedId: string | null | undefined;
  onSelect: (id: string) => void;
  ariaLabel: string;
}) {
  const { pagination, setMailboxPage } = usePaginatedMailboxRows(rows, selectedId);

  return (
    <>
      <nav className="space-y-0.5" aria-label={ariaLabel}>
        {pagination.pageItems.map((row) => {
          const Icon = row.icon;
          const active = selectedId === row.id;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => onSelect(row.id)}
              className={cn(
                "mail-sidebar-folder flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
                active ? "mail-nav-active" : "mail-nav-item",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
            </button>
          );
        })}
      </nav>
      <MailSidebarMailboxPager
        page={pagination.safePage}
        totalPages={pagination.totalPages}
        onPageChange={setMailboxPage}
      />
    </>
  );
}

function ProductionMailFolderNav({
  onCompose,
  onFolderSelect,
  className,
  showComposeButton = true,
}: {
  onCompose: () => void;
  onFolderSelect?: (folder: MailWorkspaceFolder) => void;
  className?: string;
  showComposeButton?: boolean;
}) {
  const { t } = useTranslation();
  const { capabilities } = useMailSession();
  const canReview = canReviewApprovals(capabilities);
  const approvalWorkspace = useOptionalMailApprovalWorkspace();
  const workspace = useMailWorkspace();
  const mailboxSections = resolveMailboxSidebarSections(
    workspace.mailboxes.map(adaptAccessibleMailbox),
  );
  const mailboxRows = useMemo<PaginatedMailboxRow[]>(
    () => [
      ...mailboxSections.personalMailboxes.map((box) => ({
        id: box.id,
        label: box.displayName ?? t("mail.mailbox.personal"),
        icon: Inbox,
      })),
      ...mailboxSections.sharedMailboxes.map((box) => ({
        id: box.id,
        label: box.displayName ?? t("mail.mailbox.shared"),
        icon: Users,
      })),
    ],
    [mailboxSections.personalMailboxes, mailboxSections.sharedMailboxes, t],
  );

  function ProductionFolderButton({
    folder,
  }: {
    folder:
      | (typeof PRODUCTION_MAIL_READ_FOLDERS)[number]
      | ReturnType<typeof filterVisibleWorkflowFolders>[number];
  }) {
    const active = workspace.selectedFolder === folder.id;
    const labelKey = isProductionMailReadFolder(folder.id)
      ? folder.labelKey
      : resolveWorkflowFolderLabelKey(folder.id, canReview);
    return (
      <button
        type="button"
        onClick={() => {
          if (folder.id === "pending_approval") {
            if (onFolderSelect) {
              onFolderSelect("pending_approval");
            } else {
              void workspace.selectFolder("pending_approval");
            }
            void approvalWorkspace?.loadApprovals();
            approvalWorkspace?.clearSelection();
            return;
          }
          if (onFolderSelect) {
            onFolderSelect(folder.id);
            return;
          }
          void workspace.selectFolder(folder.id);
        }}
        className={cn(
          "mail-sidebar-folder flex min-h-9 w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
          active ? "mail-nav-active" : "mail-nav-item",
        )}
      >
        <span className="truncate">{t(labelKey)}</span>
      </button>
    );
  }

  return (
    <aside className={cn("flex flex-col gap-3", className)}>
      {showComposeButton ? (
        <Button
          type="button"
          size="sm"
          className="mail-compose-button h-10 w-full justify-center gap-2 rounded-xl shadow-sm"
          onClick={onCompose}
        >
          <Plus className="h-4 w-4" />
          {t("mail.compose.new")}
        </Button>
      ) : null}

      <div className="mail-sidebar-section">
        <p className="mail-sidebar-section-label mb-1.5 px-2.5">
          {t("mail.sidebar.folders")}
        </p>
        <nav className="space-y-0.5" aria-label={t("mail.sidebar.folders")}>
          {PRODUCTION_MAIL_READ_FOLDERS.map((folder) => (
            <ProductionFolderButton key={folder.id} folder={folder} />
          ))}
          {filterVisibleWorkflowFolders(canReview).map((folder) => (
            <ProductionFolderButton key={folder.id} folder={folder} />
          ))}
        </nav>
      </div>

      {mailboxSections.showSection && mailboxSections.sectionLabelKey ? (
        <div className="mail-sidebar-section">
          <p className="mail-sidebar-section-label mb-1.5 px-2.5">
            {t(mailboxSections.sectionLabelKey)}
          </p>
          <PaginatedMailboxNav
            rows={mailboxRows}
            selectedId={workspace.selectedMailboxId}
            onSelect={(mailboxId) => {
              void workspace.selectMailbox(mailboxId);
            }}
            ariaLabel={t(mailboxSections.sectionLabelKey)}
          />
        </div>
      ) : null}
    </aside>
  );
}

function PrototypeMailFolderNav({
  onCompose,
  className,
  showComposeButton = true,
}: {
  onCompose: () => void;
  className?: string;
  showComposeButton?: boolean;
}) {
  const { t } = useTranslation();
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
  const folders = visibleMailFolders(isAdminScenario);
  const mailFolders = folders.filter((f) => f.section === "mail");
  const adminFolders = folders.filter((f) => f.section === "admin");
  const mailboxSections = resolveMailboxSidebarSections(
    mailboxes.map(adaptPrototypeSidebarMailbox),
  );
  const mailboxRows = useMemo<PaginatedMailboxRow[]>(
    () => [
      ...mailboxSections.personalMailboxes.map((box) => ({
        id: box.address,
        label: box.displayName ?? t("mail.mailbox.personal"),
        icon: Inbox,
      })),
      ...mailboxSections.sharedMailboxes.map((box) => ({
        id: box.address,
        label: box.displayName ?? t("mail.mailbox.shared"),
        icon: Users,
      })),
    ],
    [mailboxSections.personalMailboxes, mailboxSections.sharedMailboxes, t],
  );

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
        {count > 0 ? (
          <span
            className={cn(
              "mail-folder-count ml-2 shrink-0 text-xs tabular-nums",
              active ? "opacity-90" : "crm-text-secondary",
            )}
          >
            {count}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <aside className={cn("flex flex-col gap-3", className)}>
      {showComposeButton ? (
        <Button
          type="button"
          size="sm"
          className="mail-compose-button h-10 w-full justify-center gap-2 rounded-xl shadow-sm"
          onClick={onCompose}
        >
          <Plus className="h-4 w-4" />
          {t("mail.compose.new")}
        </Button>
      ) : null}

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

      {mailboxSections.showSection && mailboxSections.sectionLabelKey ? (
        <div className="mail-sidebar-section">
          <p className="mail-sidebar-section-label mb-1.5 px-2.5">
            {t(mailboxSections.sectionLabelKey)}
          </p>
          <PaginatedMailboxNav
            rows={mailboxRows}
            selectedId={activeMailbox}
            onSelect={(address) => {
              setActiveMailbox(address);
              setActiveFolder("inbox");
              setSelectedId(null);
            }}
            ariaLabel={t(mailboxSections.sectionLabelKey)}
          />
        </div>
      ) : null}

      {adminFolders.length > 0 ? (
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
      ) : null}
    </aside>
  );
}

export function MailFolderNav({
  onCompose,
  onFolderSelect,
  className,
  showComposeButton = true,
}: {
  onCompose: () => void;
  onFolderSelect?: (folder: MailWorkspaceFolder) => void;
  className?: string;
  showComposeButton?: boolean;
}) {
  const isProduction = useIsProductionMailReadSource();
  const workspace = useOptionalMailWorkspace();

  if (isProduction && workspace) {
    return (
      <ProductionMailFolderNav
        onCompose={onCompose}
        onFolderSelect={onFolderSelect}
        className={className}
        showComposeButton={showComposeButton}
      />
    );
  }

  return (
    <PrototypeMailFolderNav
      onCompose={onCompose}
      className={className}
      showComposeButton={showComposeButton}
    />
  );
}
