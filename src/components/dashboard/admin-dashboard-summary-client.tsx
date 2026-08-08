"use client";

import Link from "next/link";
import { KpiCard, kpiIcons } from "@/components/dashboard/dashboard-widgets";
import { useTranslation } from "@/i18n/provider";
import { buildValidFollowUpsTodayHref } from "@/lib/reports/dashboard-drilldown-links";
import type { AdminDashboardSummary } from "@/lib/reports/dashboard-summary-types";

const linkClass =
  "text-[#2F6FB3] hover:text-[#1F4E79] hover:underline text-xs";

type Props = {
  summary: AdminDashboardSummary;
};

export function AdminDashboardSummaryClient({ summary }: Props) {
  const { t } = useTranslation();
  const { metrics } = summary;
  const validFollowUpsTodayHref = buildValidFollowUpsTodayHref();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="section-title mb-4">
          {t("dashboard.todayManagementPriorities")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <Link href="/customers" className="block">
            <KpiCard
              label={t("dashboard.newCustomersToday")}
              value={metrics.newCustomersToday}
              icon={kpiIcons.users}
            />
          </Link>
          {metrics.validFollowUpsToday > 0 ? (
            <Link href={validFollowUpsTodayHref} className="block">
              <KpiCard
                label={t("dashboard.validFollowUpsToday")}
                value={metrics.validFollowUpsToday}
                icon={kpiIcons.clipboard}
              />
            </Link>
          ) : (
            <KpiCard
              label={t("dashboard.validFollowUpsToday")}
              value={metrics.validFollowUpsToday}
              icon={kpiIcons.clipboard}
            />
          )}
          <Link href="/approvals" className="block">
            <KpiCard
              label={t("dashboard.pendingApprovals")}
              value={metrics.pendingApprovals}
              variant="warning"
              hint={
                <span className={linkClass}>
                  {t("dashboard.goToApprovals")}
                </span>
              }
              icon={kpiIcons.clipboard}
            />
          </Link>
          <Link href="/customers?reclamationRisk=team" className="block">
            <KpiCard
              label={t("dashboard.autoReleaseWithin7Days")}
              value={metrics.autoReleaseWithin7Days}
              variant="warning"
              icon={kpiIcons.alert}
            />
          </Link>
          <Link href="/customers?reclamationRisk=team" className="block">
            <KpiCard
              label={t("dashboard.autoReleaseTomorrow")}
              value={metrics.autoReleaseTomorrow}
              variant="danger"
              icon={kpiIcons.alert}
            />
          </Link>
          <Link href="/customers?workView=overdue" className="block">
            <KpiCard
              label={t("dashboard.overdueFollowUps")}
              value={metrics.overdueFollowUps}
              variant="danger"
              icon={kpiIcons.alert}
            />
          </Link>
          <Link href="/public-pool" className="block">
            <KpiCard
              label={t("dashboard.publicPoolEnteredToday")}
              value={metrics.publicPoolEnteredToday}
              icon={kpiIcons.waves}
            />
          </Link>
        </div>
      </div>

      <div>
        <h2 className="section-title mb-4">{t("dashboard.clientsOverview")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/customers" className="block">
            <KpiCard
              label={t("dashboard.totalClients")}
              value={metrics.totalCustomers}
              hint={t("dashboard.excludingArchived")}
              icon={kpiIcons.users}
            />
          </Link>
        </div>
      </div>
    </div>
  );
}
