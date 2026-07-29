"use client";

import { Info } from "lucide-react";
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

const kpiGridClass = "grid grid-cols-2 gap-3 lg:grid-cols-4";
const staffFollowUpGridClass = "grid grid-cols-2 gap-3 lg:grid-cols-3";

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
    <div className="space-y-5">
      <PageIntro
        compact
        title={t("reports.title")}
        description={t("reports.staffDescription")}
      />

      <div
        className="surface-muted flex gap-2.5 rounded-xl px-3 py-2.5 text-xs leading-relaxed crm-text-secondary"
        data-reports-scope-note
      >
        <Info
          className="mt-0.5 h-4 w-4 shrink-0 opacity-80"
          aria-hidden
        />
        <p>{t("reports.scopeNoteStaff")}</p>
      </div>

      {!hasAnyData && (
        <div
          className="surface-muted rounded-xl px-3.5 py-3"
          data-reports-empty-banner
        >
          <p className="text-sm font-medium crm-text">
            {t("reports.noReportDataTitle")}
          </p>
          <p className="mt-1 text-xs leading-relaxed crm-text-secondary">
            {t("reports.noReportDataDescription")}
          </p>
        </div>
      )}

      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold text-[#172033]">
          {t("reports.myCustomerOverview")}
        </h2>
        <div className={kpiGridClass} data-reports-kpi-grid>
          <KpiCard
            compact
            label={t("reports.myTotalCustomers")}
            value={stats.myCustomers}
            hint={t("dashboard.myClientsHint")}
            icon={kpiIcons.users}
          />
          <KpiCard
            compact
            label={t("reports.myNewToday")}
            value={stats.myNewCustomersToday}
            icon={kpiIcons.trend}
          />
          <KpiCard
            compact
            label={t("reports.myNewThisWeek")}
            value={stats.myNewCustomersThisWeek}
            icon={kpiIcons.trend}
          />
          <KpiCard
            compact
            label={t("reports.myNewThisMonth")}
            value={stats.myNewCustomersThisMonth}
            icon={kpiIcons.trend}
          />
        </div>
      </section>

      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold text-[#172033]">
          {t("reports.myFollowUpOverview")}
        </h2>
        <div className={staffFollowUpGridClass} data-reports-kpi-grid>
          <KpiCard
            compact
            label={t("reports.myFollowUpsToday")}
            value={stats.myFollowUpsToday}
            icon={kpiIcons.clipboard}
          />
          <KpiCard
            compact
            label={t("reports.myFollowUpsThisWeek")}
            value={stats.myFollowUpsThisWeek}
            icon={kpiIcons.clipboard}
          />
          <KpiCard
            compact
            label={t("reports.myFollowUpsThisMonth")}
            value={stats.myFollowUpsThisMonth}
            icon={kpiIcons.clipboard}
          />
        </div>
      </section>

      <Card className="p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-semibold text-[#172033]">
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

      <Card className="p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-semibold text-[#172033]">
          {t("reports.recentFollowUps")}
        </h3>
        <RecentFollowUpsList items={stats.recentFollowUps} />
      </Card>
    </div>
  );
}
