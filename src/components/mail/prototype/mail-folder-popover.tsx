"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import { canReviewApprovals } from "@/lib/mail/client/approval-workflow-management";
import { useOptionalMailApprovalWorkspace } from "@/lib/mail/client/mail-approval-workspace-context";
import { useIsProductionMailReadSource } from "@/lib/mail/client/mail-read-source-context";
import { useOptionalMailWorkspace } from "@/lib/mail/client/mail-workspace-context";
import {
  adaptAccessibleMailbox,
  adaptPrototypeSidebarMailbox,
  filterVisibleWorkflowFolders,
  PRODUCTION_MAIL_READ_FOLDERS,
  resolveMailboxSidebarSections,
  resolveWorkflowFolderLabelKey,
} from "@/lib/mail/client/mail-workspace-ui-adapters";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import { MAIL_FOLDER_DEFS } from "@/lib/mail/prototype/mail-folder-config";
import type { MailFolderId } from "@/lib/mail/prototype/types";

const POPOVER_MAX_HEIGHT_PX = 260;
const POPOVER_TARGET_WIDTH_PX = 240;
const POPOVER_VIEWPORT_GUTTER_PX = 16;

function FolderMenuRow({
  label,
  count,
  active,
  onSelect,
}: {
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        onClick={onSelect}
        className={cn(
          "mail-folder-popover-row flex w-full min-h-10 items-center justify-between gap-2 px-2.5 text-left text-sm",
          active ? "mail-folder-popover-row-active" : "mail-folder-popover-row-idle",
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {active ? (
            <Check className="h-3 w-3 shrink-0" aria-hidden />
          ) : (
            <span className="w-3 shrink-0" aria-hidden />
          )}
          <span className={cn("truncate", active && "font-medium")}>{label}</span>
        </span>
        {count > 0 && (
          <span className="shrink-0 text-xs tabular-nums crm-text-secondary">
            {count}
          </span>
        )}
      </button>
    </li>
  );
}

export function MailFolderPopover({
  open,
  onClose,
  anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const isProduction = useIsProductionMailReadSource();
  const workspace = useOptionalMailWorkspace();
  const { capabilities } = useMailSession();
  const canReview = canReviewApprovals(capabilities);
  const approvalWorkspace = useOptionalMailApprovalWorkspace();
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

  useEffect(() => {
    if (!open) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const anchorRect = anchorRef.current?.getBoundingClientRect();
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 390;
  const panelWidth = Math.min(
    POPOVER_TARGET_WIDTH_PX,
    viewportWidth - POPOVER_VIEWPORT_GUTTER_PX * 2,
  );
  const left = anchorRect
    ? Math.max(
        POPOVER_VIEWPORT_GUTTER_PX,
        Math.min(
          anchorRect.left,
          viewportWidth - panelWidth - POPOVER_VIEWPORT_GUTTER_PX,
        ),
      )
    : POPOVER_VIEWPORT_GUTTER_PX;
  const top = anchorRect ? anchorRect.bottom + 4 : 0;
  const maxHeight = `min(${POPOVER_MAX_HEIGHT_PX}px, calc(100dvh - 6rem))`;

  if (isProduction && workspace) {
    const mailboxSections = resolveMailboxSidebarSections(
      workspace.mailboxes.map(adaptAccessibleMailbox),
    );
    const switcherMailboxes = [
      ...mailboxSections.personalMailboxes,
      ...mailboxSections.sharedMailboxes,
    ];

    return (
      <div className="fixed inset-0 z-50 pointer-events-none" role="presentation">
        <div
          ref={panelRef}
          role="menu"
          className="mail-folder-popover pointer-events-auto fixed overflow-hidden rounded-md border crm-border bg-[var(--color-crm-bg)]"
          style={{
            top,
            left,
            width: panelWidth,
            maxHeight,
          }}
        >
          <div
            className="mail-folder-popover-scroll overflow-y-auto overscroll-contain py-0.5"
            style={{ maxHeight }}
          >
            {mailboxSections.showSection && (
              <ul className="border-b border-black/[0.06] dark:border-white/[0.08]">
                {switcherMailboxes.map((box) => {
                  const active = box.id === workspace.selectedMailboxId;
                  return (
                    <li key={box.id}>
                      <button
                        type="button"
                        onClick={() => {
                          void workspace.selectMailbox(box.id);
                          onClose();
                        }}
                        className={cn(
                          "mail-folder-popover-row flex w-full min-h-10 items-center gap-1.5 px-2.5 text-left text-sm",
                          active
                            ? "mail-folder-popover-row-active"
                            : "mail-folder-popover-row-idle",
                        )}
                      >
                        {active ? (
                          <Check className="h-3 w-3 shrink-0" aria-hidden />
                        ) : (
                          <span className="w-3 shrink-0" aria-hidden />
                        )}
                        <span className="min-w-0 truncate">
                          {box.displayName ?? box.address}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <ul>
              {PRODUCTION_MAIL_READ_FOLDERS.map((folder) => (
                <FolderMenuRow
                  key={folder.id}
                  label={t(folder.labelKey)}
                  count={0}
                  active={workspace.selectedFolder === folder.id}
                  onSelect={() => {
                    void workspace.selectFolder(folder.id);
                    onClose();
                  }}
                />
              ))}
              {filterVisibleWorkflowFolders(canReview).map((folder) => {
                const labelKey = resolveWorkflowFolderLabelKey(folder.id, canReview);
                return (
                  <FolderMenuRow
                    key={folder.id}
                    label={t(labelKey)}
                    count={0}
                    active={workspace.selectedFolder === folder.id}
                    onSelect={() => {
                      if (folder.id === "pending_approval") {
                        void workspace.selectFolder("pending_approval");
                        void approvalWorkspace?.loadApprovals();
                        approvalWorkspace?.clearSelection();
                      } else {
                        void workspace.selectFolder(folder.id);
                      }
                      onClose();
                    }}
                  />
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  function selectFolder(id: MailFolderId) {
    setActiveFolder(id);
    setSelectedId(null);
    onClose();
  }

  const mailFolders = MAIL_FOLDER_DEFS.filter(
    (f) => f.section === "mail" && (!f.adminOnly || isAdminScenario),
  );
  const adminFolders = MAIL_FOLDER_DEFS.filter(
    (f) => f.section === "admin" && isAdminScenario,
  );

  return (
    <div className="fixed inset-0 z-50 pointer-events-none" role="presentation">
      <div
        ref={panelRef}
        role="menu"
        className="mail-folder-popover pointer-events-auto fixed overflow-hidden rounded-md border crm-border bg-[var(--color-crm-bg)]"
        style={{
          top,
          left,
          width: panelWidth,
          maxHeight,
        }}
      >
        <div
          className="mail-folder-popover-scroll overflow-y-auto overscroll-contain py-0.5"
          style={{ maxHeight }}
        >
          {resolveMailboxSidebarSections(mailboxes.map(adaptPrototypeSidebarMailbox))
            .showSection && (
            <ul className="border-b border-black/[0.06] dark:border-white/[0.08]">
              {mailboxes.map((box) => {
                const active = box.address === activeMailbox;
                return (
                  <li key={box.address}>
                    <button
                      type="button"
                      onClick={() => setActiveMailbox(box.address)}
                      className={cn(
                        "mail-folder-popover-row flex w-full min-h-10 items-center gap-1.5 px-2.5 text-left text-sm",
                        active
                          ? "mail-folder-popover-row-active"
                          : "mail-folder-popover-row-idle",
                      )}
                    >
                      {active ? (
                        <Check className="h-3 w-3 shrink-0" aria-hidden />
                      ) : (
                        <span className="w-3 shrink-0" aria-hidden />
                      )}
                      <span className="min-w-0 truncate">
                        {box.displayName ?? box.address}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <ul>
            {mailFolders.map((folder) => (
              <FolderMenuRow
                key={folder.id}
                label={t(folder.labelKey)}
                count={folderCounts[folder.id]}
                active={activeFolder === folder.id}
                onSelect={() => selectFolder(folder.id)}
              />
            ))}
          </ul>

          {adminFolders.length > 0 && (
            <ul className="border-t border-black/[0.06] dark:border-white/[0.08]">
              {adminFolders.map((folder) => (
                <FolderMenuRow
                  key={folder.id}
                  label={t(folder.labelKey)}
                  count={folderCounts[folder.id]}
                  active={activeFolder === folder.id}
                  onSelect={() => selectFolder(folder.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
