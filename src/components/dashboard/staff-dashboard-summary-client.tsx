"use client";

import Link from "next/link";
import { KpiCard, kpiIcons } from "@/components/dashboard/dashboard-widgets";
import { useTranslation } from "@/i18n/provider";
import type { StaffDashboardSummary } from "@/lib/reports/dashboard-summary-types";

const linkClass =
  "text-[#2F6FB3] hover:text-[#1F4E79] hover:underline text-xs";

type Props = {
  summary: StaffDashboardSummary;
};

export function StaffDashboardSummaryClient({ summary }: Props) {
  const { t } = useTranslation();
  const { metrics } = summary;

  return (
    <div className="space-y-6">
      <p className="text-base crm-text-secondary">
        {t("dashboard.staffWelcomeDueToday", {
          count: String(metrics.dueTodayFollowUps),
        })}
      </p>

      <div>
        <h2 className="section-title mb-4">{t("dashboard.todayPriorities")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <Link href="/customers?workView=dueToday" className="block">
            <KpiCard
              label={t("dashboard.dueTodayFollowUps")}
              value={metrics.dueTodayFollowUps}
              hint={
                <span className={linkClass}>{t("dashboard.viewClients")}</span>
              }
              icon={kpiIcons.clock}
            />
          </Link>
          <Link href="/customers?workView=overdue" className="block">
            <KpiCard
              label={t("dashboard.overdueFollowUps")}
              value={metrics.overdueFollowUps}
              variant="danger"
              hint={
                <span className={linkClass}>{t("dashboard.viewClients")}</span>
              }
              icon={kpiIcons.alert}
            />
          </Link>
          <Link href="/customers?reclamationRisk=mine" className="block">
            <KpiCard
              label={t("dashboard.autoReleaseWithin7Days")}
              value={metrics.autoReleaseWithin7Days}
              variant="warning"
              icon={kpiIcons.alert}
            />
          </Link>
          <Link href="/customers?reclamationRisk=mine" className="block">
            <KpiCard
              label={t("dashboard.autoReleaseTomorrow")}
              value={metrics.autoReleaseTomorrow}
              variant="danger"
              icon={kpiIcons.alert}
            />
          </Link>
          <Link href="/work-items?tab=notifications&view=unread" className="block">
            <KpiCard
              label={t("dashboard.pendingWorkItems")}
              value={metrics.pendingWorkItems}
              variant="warning"
              hint={
                <span className={linkClass}>{t("dashboard.viewWorkItems")}</span>
              }
              icon={kpiIcons.clipboard}
            />
          </Link>
          <KpiCard
            label={t("dashboard.validFollowUpsToday")}
            value={metrics.validFollowUpsToday}
            icon={kpiIcons.trend}
          />
        </div>
      </div>

      <div>
        <h2 className="section-title mb-4">{t("dashboard.myClientsOverview")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/customers" className="block">
            <KpiCard
              label={t("dashboard.myClients")}
              value={metrics.myCustomerCount}
              hint={
                <span className={linkClass}>{t("dashboard.viewClients")}</span>
              }
              icon={kpiIcons.users}
            />
          </Link>
        </div>
      </div>
    </div>
  );
}
