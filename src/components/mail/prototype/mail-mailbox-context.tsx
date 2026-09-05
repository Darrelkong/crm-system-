"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { QuickEntryDrawer } from "@/components/ui/quick-entry-drawer";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import { useOptionalMailWorkspace } from "@/lib/mail/client/mail-workspace-context";
import {
  adaptAccessibleMailbox,
  resolveMailboxSidebarSections,
  type MailSidebarMailboxPresentation,
} from "@/lib/mail/client/mail-workspace-ui-adapters";

type MailMailboxContextProps = {
  variant: "mobile" | "desktop";
  returnFocusRef?: React.RefObject<HTMLElement | null>;
};

function mailboxPrimaryLabel(mailbox: MailSidebarMailboxPresentation): string {
  return mailbox.displayName?.trim() || mailbox.address;
}

function MailboxOption({
  mailbox,
  selected,
  onSelect,
}: {
  mailbox: MailSidebarMailboxPresentation;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const primary = mailboxPrimaryLabel(mailbox);

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        selected
          ? "bg-[var(--color-crm-primary)]/[0.08] crm-text"
          : "crm-text hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
      )}
    >
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
          selected
            ? "border-[var(--color-crm-primary)] text-[var(--color-crm-primary)]"
            : "crm-border crm-text-secondary",
        )}
        aria-hidden
      >
        {selected ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{primary}</span>
        {mailbox.displayName && mailbox.displayName !== mailbox.address ? (
          <span className="mt-0.5 block truncate text-xs crm-text-secondary">
            {mailbox.address}
          </span>
        ) : null}
        {mailbox.mailboxType === "shared" ? (
          <span className="mt-0.5 block text-xs crm-text-secondary">
            {t("mail.mailbox.shared")}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function MailMailboxContext({
  variant,
  returnFocusRef,
}: MailMailboxContextProps) {
  const { t } = useTranslation();
  const { isCrmRootAdmin } = useMailSession();
  const workspace = useOptionalMailWorkspace();
  const [sheetOpen, setSheetOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectorId = useId();

  if (!workspace || workspace.mailboxes.length === 0) {
    return null;
  }

  const mailboxes = workspace.mailboxes.map(adaptAccessibleMailbox);
  const sections = resolveMailboxSidebarSections(mailboxes);
  const selected =
    mailboxes.find((mailbox) => mailbox.id === workspace.selectedMailboxId) ??
    mailboxes[0]!;
  const showAllOption = isCrmRootAdmin && mailboxes.length > 1;
  const isAllSelected = workspace.mailboxScope === "all";
  const hasMultipleMailboxes = mailboxes.length > 1;
  const isSinglePersonalMailbox =
    mailboxes.length === 1 && selected.mailboxType === "personal";
  const isSharedOnlyMailbox =
    mailboxes.length === 1 && selected.mailboxType === "shared";
  const showContext =
    hasMultipleMailboxes || isSinglePersonalMailbox || isSharedOnlyMailbox;

  if (!showContext) {
    return null;
  }

  const primary = isAllSelected
    ? t("mail.mailbox.all")
    : mailboxPrimaryLabel(selected);
  const showAddress = variant === "desktop" && !isAllSelected;
  const isMobileSharedMailbox =
    variant === "mobile" && selected.mailboxType === "shared";

  return (
    <>
      <div
        className={cn(
          "mail-mailbox-context shrink-0",
          variant === "mobile"
            ? "border-b crm-border px-3 py-0"
            : "mail-sidebar-section px-0",
        )}
      >
        {hasMultipleMailboxes ? (
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setSheetOpen((open) => !open)}
            className={cn(
              "min-w-0 items-center text-left crm-text",
              variant === "mobile"
                ? "inline-flex min-h-8 w-fit max-w-full gap-1 rounded-md px-1.5"
                : "mail-sidebar-mailbox-context-button flex min-h-12 w-full gap-2 rounded-lg px-2.5 py-1.5",
            )}
            aria-label={t("mail.folderSheet.mailboxes")}
            aria-controls={variant === "mobile" ? selectorId : undefined}
            aria-expanded={sheetOpen}
            aria-haspopup={variant === "mobile" ? "menu" : "dialog"}
          >
            <span
              className={cn(
                "min-w-0",
                variant === "mobile"
                  ? "inline-flex max-w-full items-center gap-1.5"
                  : "flex-1",
              )}
            >
              <span
                className={cn(
                  "block min-w-0 truncate",
                  variant === "mobile"
                    ? "text-[13px] font-normal"
                    : "text-sm font-medium",
                )}
              >
                {primary}
              </span>
              {showAddress ? (
                <span className="block truncate text-xs crm-text-secondary">
                  {selected.address}
                </span>
              ) : null}
              {isMobileSharedMailbox ? (
                <span className="shrink-0 text-xs crm-text-secondary">
                  {t("mail.mailbox.shared")}
                </span>
              ) : null}
            </span>
            <ChevronDown
              className="h-3.5 w-3.5 shrink-0 crm-text-secondary"
              aria-hidden
            />
          </button>
        ) : (
          <div
            className={cn(
              "min-w-0 items-center crm-text",
              variant === "mobile"
                ? "inline-flex min-h-8 w-fit max-w-full gap-1.5 px-1.5"
                : "flex min-h-12 rounded-lg gap-2 px-2.5 py-1.5",
            )}
          >
            <span
              className={cn(
                "min-w-0",
                variant === "mobile"
                  ? "inline-flex max-w-full items-center gap-1.5"
                  : "flex-1",
              )}
            >
              <span
                className={cn(
                  "block min-w-0 truncate",
                  variant === "mobile"
                    ? "text-[13px] font-normal"
                    : "text-sm font-medium",
                )}
              >
                {primary}
              </span>
              {showAddress ? (
                <span className="block truncate text-xs crm-text-secondary">
                  {selected.address}
                </span>
              ) : null}
              {isMobileSharedMailbox ? (
                <span className="shrink-0 text-xs crm-text-secondary">
                  {t("mail.mailbox.shared")}
                </span>
              ) : null}
            </span>
            {isSharedOnlyMailbox && variant === "desktop" ? (
              <span className="shrink-0 text-xs crm-text-secondary">
                {t("mail.mailbox.shared")}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {hasMultipleMailboxes ? (
        variant === "mobile" ? (
          <MailMailboxContextPopover
            id={selectorId}
            open={sheetOpen}
            anchorRef={triggerRef}
            sections={sections}
            selectedMailboxId={
              isAllSelected ? null : workspace.selectedMailboxId
            }
            showAllOption={showAllOption}
            allSelected={isAllSelected}
            onSelectAll={() => {
              void workspace.selectAllMailboxes();
            }}
            onSelect={(mailboxId) => {
              void workspace.selectMailbox(mailboxId);
            }}
            onClose={() => setSheetOpen(false)}
            returnFocusRef={returnFocusRef ?? triggerRef}
          />
        ) : (
          <MailMailboxContextSheet
            open={sheetOpen}
            sections={sections}
            selectedMailboxId={
              isAllSelected ? null : workspace.selectedMailboxId
            }
            showAllOption={showAllOption}
            allSelected={isAllSelected}
            onSelectAll={() => {
              void workspace.selectAllMailboxes();
            }}
            onSelect={(mailboxId) => {
              void workspace.selectMailbox(mailboxId);
            }}
            onClose={() => setSheetOpen(false)}
            returnFocusRef={returnFocusRef ?? triggerRef}
          />
        )
      ) : null}
    </>
  );
}

type MailboxContextOptionsProps = {
  sections: ReturnType<typeof resolveMailboxSidebarSections>;
  selectedMailboxId: string | null;
  showAllOption: boolean;
  allSelected: boolean;
  onSelectAll: () => void;
  onSelect: (mailboxId: string) => void;
  onClose: () => void;
};

function MailMailboxContextOptions({
  sections,
  selectedMailboxId,
  showAllOption,
  allSelected,
  onSelectAll,
  onSelect,
  onClose,
}: MailboxContextOptionsProps) {
  const { t } = useTranslation();

  const renderSection = (
    labelKey: "mail.mailbox.personal" | "mail.mailbox.shared",
    mailboxes: MailSidebarMailboxPresentation[],
  ) =>
    mailboxes.length > 0 ? (
      <section
        key={labelKey}
        className="border-b crm-border px-2 py-2 last:border-b-0"
      >
        <p className="px-3 pb-1 text-xs font-medium crm-text-secondary">
          {t(labelKey)}
        </p>
        <div className="space-y-0.5">
          {mailboxes.map((mailbox) => (
            <MailboxOption
              key={mailbox.id}
              mailbox={mailbox}
              selected={selectedMailboxId === mailbox.id}
              onSelect={() => {
                onSelect(mailbox.id);
                onClose();
              }}
            />
          ))}
        </div>
      </section>
    ) : null;

  return (
    <div className="p-2">
      {showAllOption ? (
        <section className="border-b crm-border px-2 py-2">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={allSelected}
            onClick={() => {
              onSelectAll();
              onClose();
            }}
            className={cn(
              "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
              allSelected
                ? "bg-[var(--color-crm-primary)]/[0.08] crm-text"
                : "crm-text hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                allSelected
                  ? "border-[var(--color-crm-primary)] text-[var(--color-crm-primary)]"
                  : "crm-border crm-text-secondary",
              )}
              aria-hidden
            >
              {allSelected ? <Check className="h-3.5 w-3.5" /> : null}
            </span>
            <span className="truncate text-sm font-medium">
              {t("mail.mailbox.all")}
            </span>
          </button>
        </section>
      ) : null}
      {renderSection("mail.mailbox.personal", sections.personalMailboxes)}
      {renderSection("mail.mailbox.shared", sections.sharedMailboxes)}
    </div>
  );
}

function MailMailboxContextPopover({
  id,
  open,
  anchorRef,
  sections,
  selectedMailboxId,
  showAllOption,
  allSelected,
  onSelectAll,
  onSelect,
  onClose,
  returnFocusRef,
}: MailboxContextOptionsProps & {
  id: string;
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!open) return;

    const updateAnchorRect = () => {
      setAnchorRect(anchorRef.current?.getBoundingClientRect() ?? null);
    };
    const frame = window.requestAnimationFrame(updateAnchorRect);
    window.addEventListener("resize", updateAnchorRect);
    window.addEventListener("scroll", updateAnchorRect, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateAnchorRect);
      window.removeEventListener("scroll", updateAnchorRect, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;

    const returnFocusTarget = returnFocusRef?.current;
    const firstOption = panelRef.current?.querySelector<HTMLElement>(
      'button:not([disabled])',
    );
    firstOption?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
      returnFocusTarget?.focus();
    };
  }, [open, onClose, anchorRef, returnFocusRef]);

  if (!open) return null;

  const viewportWidth =
    typeof window !== "undefined" ? window.innerWidth : 390;
  const horizontalMargin = 12;
  const panelWidth = Math.max(0, viewportWidth - horizontalMargin * 2);
  const top = anchorRect ? anchorRect.bottom + 4 : horizontalMargin;
  const maxHeight = `min(75dvh, calc(100dvh - ${Math.max(
    top,
    0,
  )}px - 6rem))`;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none" role="presentation">
      <div
        id={id}
        ref={panelRef}
        role="menu"
        aria-label={t("mail.folderSheet.mailboxes")}
        className="mail-folder-popover pointer-events-auto fixed overflow-hidden rounded-xl border crm-border bg-[var(--color-crm-card)]"
        style={{
          top,
          left: horizontalMargin,
          width: panelWidth,
          maxHeight,
        }}
      >
        <div
          className="overflow-y-auto overscroll-contain"
          style={{ maxHeight }}
        >
          <MailMailboxContextOptions
            sections={sections}
            selectedMailboxId={selectedMailboxId}
            showAllOption={showAllOption}
            allSelected={allSelected}
            onSelectAll={onSelectAll}
            onSelect={onSelect}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}

function MailMailboxContextSheet({
  open,
  sections,
  selectedMailboxId,
  showAllOption,
  allSelected,
  onSelectAll,
  onSelect,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  sections: MailboxContextOptionsProps["sections"];
  selectedMailboxId: MailboxContextOptionsProps["selectedMailboxId"];
  showAllOption: MailboxContextOptionsProps["showAllOption"];
  allSelected: MailboxContextOptionsProps["allSelected"];
  onSelectAll: MailboxContextOptionsProps["onSelectAll"];
  onSelect: MailboxContextOptionsProps["onSelect"];
  onClose: MailboxContextOptionsProps["onClose"];
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();

  return (
    <QuickEntryDrawer
      open={open}
      title={t("mail.folderSheet.mailboxes")}
      onRequestClose={onClose}
      closeLabel={t("common.close")}
      returnFocusRef={returnFocusRef}
    >
      <MailMailboxContextOptions
        sections={sections}
        selectedMailboxId={selectedMailboxId}
        showAllOption={showAllOption}
        allSelected={allSelected}
        onSelectAll={onSelectAll}
        onSelect={onSelect}
        onClose={onClose}
      />
    </QuickEntryDrawer>
  );
}
