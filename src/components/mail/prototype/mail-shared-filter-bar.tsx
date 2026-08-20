"use client";

import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { useMailPrototype } from "@/lib/mail/prototype/state";
import type { SharedViewFilter } from "@/lib/mail/prototype/shared-mailbox-types";
import { MOCK_SHARED_MAILBOX_ID } from "@/lib/mail/prototype/shared-mailbox-types";

const FILTERS: SharedViewFilter[] = [
  "all",
  "unclaimed",
  "mine",
  "waiting_customer",
  "completed",
];

export function MailSharedFilterBar({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { activeMailbox, sharedViewFilter, setSharedViewFilter } =
    useMailPrototype();

  if (activeMailbox !== MOCK_SHARED_MAILBOX_ID) return null;

  return (
    <div
      className={cn(
        "flex shrink-0 gap-1 overflow-x-auto border-b crm-border px-3 py-1.5",
        className,
      )}
    >
      {FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => setSharedViewFilter(f)}
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-xs",
            sharedViewFilter === f
              ? "mail-nav-active font-medium"
              : "crm-text-secondary hover:crm-text",
          )}
        >
          {t(`mail.shared.filter.${f}`)}
        </button>
      ))}
    </div>
  );
}
