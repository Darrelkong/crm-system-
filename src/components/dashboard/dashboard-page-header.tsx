"use client";

import { DashboardHeaderActions } from "@/components/dashboard/dashboard-header-actions";
import { useTranslation } from "@/i18n/provider";

export function DashboardPageHeader({
  displayName,
  descriptionKey,
}: {
  displayName: string;
  descriptionKey: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="page-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-base leading-snug text-[var(--color-crm-text-secondary)]">
          {t("layout.greetingHello")}
        </p>
        <h1
          className="mt-0.5 break-words text-[1.875rem] font-bold leading-tight tracking-tight text-[var(--color-crm-text)] sm:text-[2.125rem]"
        >
          {displayName}
        </h1>
        <p className="page-description mt-1.5 text-[0.9375rem] sm:text-base">
          {t(descriptionKey)}
        </p>
      </div>
      <DashboardHeaderActions />
    </div>
  );
}
