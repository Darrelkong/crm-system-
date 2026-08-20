"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
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
          {mailboxes.length > 1 && (
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
