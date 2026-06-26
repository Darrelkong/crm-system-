"use client";

import { Card } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import {
  KpiCard,
  kpiIcons,
  SimpleBarRow,
} from "@/components/dashboard/dashboard-widgets";
import { RecentFollowUpsList } from "@/components/reports/recent-follow-ups-list";
import { useTranslation } from "@/i18n/provider";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import type { StaffReportsStats } from "@/lib/reports/types";

export function StaffReportsClient({ stats }: { stats: StaffReportsStats }) {
  const { t } = useTranslation();
  const { salesStage } = useCustomerLabels();

  const maxStage = Math.max(
    ...stats.myCustomersBySalesStage.map((s) => s.count),
    1,
  );

  const hasAnyData =
    stats.myCustomers > 0 ||
    stats.myFollowUpsThisMonth > 0 ||
    stats.recentFollowUps.length > 0;

  return (
    <div className="space-y-6">
      <PageIntro
        title={t("reports.title")}
        description={t("reports.staffDescription")}
      />

      {!hasAnyData && (
        <Card className="p-6">
          <p className="text-sm text-[#6B7890]">{t("reports.noData")}</p>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[#172033]">
          {t("reports.myCustomerOverview")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label={t("reports.myTotalCustomers")}
            value={stats.myCustomers}
            hint={t("dashboard.myClientsHint")}
            icon={kpiIcons.users}
          />
          <KpiCard
            label={t("reports.myNewToday")}
            value={stats.myNewCustomersToday}
            icon={kpiIcons.trend}
          />
          <KpiCard
            label={t("reports.myNewThisWeek")}
            value={stats.myNewCustomersThisWeek}
            icon={kpiIcons.trend}
          />
          <KpiCard
            label={t("reports.myNewThisMonth")}
            value={stats.myNewCustomersThisMonth}
            icon={kpiIcons.trend}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[#172033]">
          {t("reports.myFollowUpOverview")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            label={t("reports.myFollowUpsToday")}
            value={stats.myFollowUpsToday}
            icon={kpiIcons.clipboard}
          />
          <KpiCard
            label={t("reports.myFollowUpsThisWeek")}
            value={stats.myFollowUpsThisWeek}
            icon={kpiIcons.clipboard}
          />
          <KpiCard
            label={t("reports.myFollowUpsThisMonth")}
            value={stats.myFollowUpsThisMonth}
            icon={kpiIcons.clipboard}
          />
        </div>
      </section>

      <Card>
        <h3 className="mb-4 text-sm font-semibold text-[#172033]">
          {t("reports.myStageDistribution")}
        </h3>
        {stats.myCustomersBySalesStage.length === 0 ? (
          <p className="text-sm text-[#6B7890]">{t("reports.noStageData")}</p>
        ) : (
          <div className="space-y-3">
            {stats.myCustomersBySalesStage.map((item) => (
              <SimpleBarRow
                key={item.label}
                label={salesStage(item.label)}
                count={item.count}
                max={maxStage}
              />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold text-[#172033]">
          {t("reports.recentFollowUps")}
        </h3>
        <RecentFollowUpsList items={stats.recentFollowUps} />
      </Card>
    </div>
  );
}
