"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";

export function ReportsPlaceholder({ role }: { role: "admin" | "staff" }) {
  const { t } = useTranslation();
  const dashboardHref = role === "admin" ? "/admin" : "/staff";

  return (
    <div className="space-y-6">
      <PageIntro
        title={t("nav.reports")}
        description={t("placeholders.reportsDescription")}
      />
      <EmptyState
        message={t("placeholders.reportsEmpty")}
        action={
          <Link href={dashboardHref} className="link-primary text-sm">
            {t("nav.dashboard")}
          </Link>
        }
      />
    </div>
  );
}
