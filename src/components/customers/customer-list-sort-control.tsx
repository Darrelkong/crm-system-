"use client";

import { useTranslation } from "@/i18n/provider";
import type { CustomerListSortMode } from "@/lib/customers/customer-list-sort";

type Props = {
  sortMode: CustomerListSortMode;
  onSortChange: (sort: CustomerListSortMode) => void;
  disabled?: boolean;
};

export function CustomerListSortControl({
  sortMode,
  onSortChange,
  disabled = false,
}: Props) {
  const { t } = useTranslation();

  const options: Array<{ value: CustomerListSortMode; label: string }> = [
    { value: "default", label: t("customers.sortModeDefault") },
    { value: "reclaim_soonest", label: t("customers.sortModeReclaimSoonest") },
  ];

  return (
    <div className="mb-4">
      <p className="mb-2 text-sm font-medium crm-text">{t("customers.sortModeLabel")}</p>
      <div
        className="grid w-full grid-cols-2 gap-1 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-muted)] p-1"
        role="group"
        aria-label={t("customers.sortModeLabel")}
      >
        {options.map((option) => {
          const selected = sortMode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onSortChange(option.value)}
              aria-pressed={selected}
              className={[
                "inline-flex min-h-11 items-center justify-center rounded-md px-2 py-2.5 text-center text-sm leading-snug transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--crm-surface)]",
                "disabled:cursor-not-allowed disabled:opacity-60",
                selected
                  ? "border border-[var(--crm-border)] bg-[var(--crm-surface)] font-semibold text-[var(--crm-text)] shadow-sm"
                  : "border border-transparent font-normal crm-text-secondary hover:bg-[var(--crm-surface)]/60",
              ].join(" ")}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {sortMode === "reclaim_soonest" && (
        <p className="mt-2 text-xs crm-text-secondary">
          {t("customers.sortModeReclaimHelper")}
        </p>
      )}
    </div>
  );
}
