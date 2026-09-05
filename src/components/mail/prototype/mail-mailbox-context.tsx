"use client";

import { Check, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { QuickEntryDrawer } from "@/components/ui/quick-entry-drawer";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
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
  const workspace = useOptionalMailWorkspace();
  const [sheetOpen, setSheetOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (!workspace || workspace.mailboxes.length === 0) {
    return null;
  }

  const mailboxes = workspace.mailboxes.map(adaptAccessibleMailbox);
  const sections = resolveMailboxSidebarSections(mailboxes);
  const selected =
    mailboxes.find((mailbox) => mailbox.id === workspace.selectedMailboxId) ??
    mailboxes[0]!;
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

  const primary = mailboxPrimaryLabel(selected);
  const showAddress = variant === "desktop";
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
            onClick={() => setSheetOpen(true)}
            className={cn(
              "min-w-0 items-center text-left crm-text",
              variant === "mobile"
                ? "inline-flex min-h-8 w-fit max-w-full gap-1 rounded-md px-1.5"
                : "mail-sidebar-mailbox-context-button flex min-h-12 w-full gap-2 rounded-lg px-2.5 py-1.5",
            )}
            aria-label={t("mail.folderSheet.mailboxes")}
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
        <MailMailboxContextSheet
          open={sheetOpen}
          sections={sections}
          selectedMailboxId={workspace.selectedMailboxId}
          onSelect={(mailboxId) => {
            void workspace.selectMailbox(mailboxId);
          }}
          onClose={() => setSheetOpen(false)}
          returnFocusRef={returnFocusRef ?? triggerRef}
        />
      ) : null}
    </>
  );
}

function MailMailboxContextSheet({
  open,
  sections,
  selectedMailboxId,
  onSelect,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  sections: ReturnType<typeof resolveMailboxSidebarSections>;
  selectedMailboxId: string | null;
  onSelect: (mailboxId: string) => void;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();

  const renderSection = (
    labelKey: "mail.mailbox.personal" | "mail.mailbox.shared",
    mailboxes: MailSidebarMailboxPresentation[],
  ) =>
    mailboxes.length > 0 ? (
      <section key={labelKey} className="border-b crm-border px-2 py-2 last:border-b-0">
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
    <QuickEntryDrawer
      open={open}
      title={t("mail.folderSheet.mailboxes")}
      onRequestClose={onClose}
      closeLabel={t("common.close")}
      returnFocusRef={returnFocusRef}
    >
      <div className="p-2">
        {renderSection("mail.mailbox.personal", sections.personalMailboxes)}
        {renderSection("mail.mailbox.shared", sections.sharedMailboxes)}
      </div>
    </QuickEntryDrawer>
  );
}
