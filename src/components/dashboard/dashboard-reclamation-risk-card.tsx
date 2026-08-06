"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import type { DashboardReclamationRiskSummary } from "@/lib/reports/dashboard-summary-types";

type Props = {
  titleKey: string;
  risk: DashboardReclamationRiskSummary;
  showMemberCount?: boolean;
};

export function DashboardReclamationRiskCard({
  titleKey,
  risk,
  showMemberCount = false,
}: Props) {
  const { t } = useTranslation();
  const hasRisk =
    risk.tomorrowCount > 0 ||
    risk.within7Count > 0 ||
    risk.within14Count > 0 ||
    risk.pendingRiskCount > 0;

  return (
    <Card className="p-5">
      <h2 className="section-title mb-4">{t(titleKey)}</h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-2 sm:block">
          <dt className="crm-text-secondary">
            {t("dashboard.autoReleaseTomorrow")}
          </dt>
          <dd className="font-semibold crm-text">{risk.tomorrowCount}</dd>
        </div>
        <div className="flex justify-between gap-2 sm:block">
          <dt className="crm-text-secondary">
            {t("dashboard.autoReleaseWithin7Days")}
          </dt>
          <dd className="font-semibold crm-text">
            {risk.tomorrowCount + risk.within7Count}
          </dd>
        </div>
        <div className="flex justify-between gap-2 sm:block">
          <dt className="crm-text-secondary">
            {t("dashboard.autoReleaseWithin14Days")}
          </dt>
          <dd className="font-semibold crm-text">{risk.within14Count}</dd>
        </div>
        <div className="flex justify-between gap-2 sm:block">
          <dt className="crm-text-secondary">
            {t("dashboard.pendingReclamationCustomers")}
          </dt>
          <dd className="font-semibold crm-text">{risk.pendingRiskCount}</dd>
        </div>
        {showMemberCount && risk.memberCount != null && (
          <div className="flex justify-between gap-2 sm:col-span-2 sm:block">
            <dt className="crm-text-secondary">
              {t("dashboard.reclamationMembersInvolved")}
            </dt>
            <dd className="font-semibold crm-text">{risk.memberCount}</dd>
          </div>
        )}
      </dl>
      {!hasRisk && (
        <p className="mt-4 text-sm crm-text-secondary">
          {t("dashboard.noReclamationRisk")}
        </p>
      )}
      <div className="mt-4">
        <Link
          href={risk.drilldownHref}
          className="text-sm font-medium text-[#2F6FB3] hover:text-[#1F4E79] hover:underline"
        >
          {t("dashboard.viewRelatedCustomers")}
        </Link>
      </div>
    </Card>
  );
}
