"use client";

import { ClipboardCheck } from "lucide-react";
import { useTranslation } from "@/i18n/provider";

export function MailApprovalEntryButton({
  pendingCount,
  onClick,
  compact = false,
}: {
  pendingCount: number;
  onClick: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const hasPending = pendingCount > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        compact
          ? "mail-sidebar-icon-btn relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg crm-text-secondary"
          : "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg crm-text-secondary transition-colors hover:bg-black/[0.04] hover:crm-text dark:hover:bg-white/[0.06]"
      }
      aria-label={t("mail.approvalCenter.open")}
      title={t("mail.approvalCenter.open")}
    >
      <ClipboardCheck className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
      {hasPending ? (
        <span
          className="absolute right-0.5 top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-crm-primary)] px-1 text-[10px] font-semibold leading-4 text-white shadow-sm"
          aria-label={t("mail.approvalCenter.pendingBadge", {
            count: String(pendingCount),
          })}
        >
          {pendingCount > 99 ? "99+" : pendingCount}
        </span>
      ) : null}
    </button>
  );
}
