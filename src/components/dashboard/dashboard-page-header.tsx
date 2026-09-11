"use client";

import { DashboardHeaderActions } from "@/components/dashboard/dashboard-header-actions";
import { useTranslation } from "@/i18n/provider";

export function DashboardPageHeader({
  displayName,
  descriptionKey,
  nameEmphasis = "staff",
}: {
  displayName: string;
  descriptionKey: string;
  nameEmphasis?: "admin" | "staff";
}) {
  const { t } = useTranslation();
  const displayNameClassName =
    nameEmphasis === "admin"
      ? "text-[2rem] font-bold leading-[1.1] tracking-tight sm:text-[2.375rem]"
      : "text-[1.875rem] font-bold leading-tight tracking-tight sm:text-[2.125rem]";

  return (
    <div className="page-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-[1.0625rem] leading-snug text-[var(--color-crm-text-secondary)] sm:text-lg">
          {t("layout.greetingHello")}
        </p>
        <h1
          className={`mt-0.5 break-words text-[var(--color-crm-text)] ${displayNameClassName}`}
        >
          {displayName}
        </h1>
        <p className="page-description mt-1.5 text-[0.9375rem] sm:text-base">
          {t(descriptionKey)}
        </p>
      </div>
      <div className="flex w-full justify-end sm:w-auto sm:shrink-0">
        <DashboardHeaderActions />
      </div>
    </div>
  );
}
