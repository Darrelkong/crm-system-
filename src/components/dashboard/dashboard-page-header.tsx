"use client";

import { DashboardHeaderActions } from "@/components/dashboard/dashboard-header-actions";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";

function getAdminDisplayNameClass(displayName: string): string {
  const length = displayName.length;
  if (length > 18) {
    return "text-[1.75rem] leading-[1.12] sm:text-[1.875rem]";
  }
  if (length > 12) {
    return "text-[2rem] leading-[1.1] sm:text-[2.125rem]";
  }
  return "text-[2.25rem] leading-[1.08] sm:text-[2.5rem]";
}

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
      ? cn(
          "font-bold tracking-tight text-[var(--color-crm-text)] break-words",
          getAdminDisplayNameClass(displayName),
        )
      : "text-[1.875rem] font-bold leading-tight tracking-tight text-[var(--color-crm-text)] break-words sm:text-[2.125rem]";

  return (
    <div className="page-header">
      <div className="min-w-0">
        <p className="text-[1.125rem] font-medium leading-snug text-slate-500 sm:text-[1.1875rem]">
          {t("layout.greetingHello")}
        </p>
        <h1 className={cn("mt-1", displayNameClassName)}>{displayName}</h1>
        <p className="page-description mt-2 text-[0.9375rem] sm:text-base">
          {t(descriptionKey)}
        </p>
        <div className="mt-6 sm:mt-7">
          <DashboardHeaderActions />
        </div>
      </div>
    </div>
  );
}
