"use client";

import Link from "next/link";
import { KpiCard, kpiIcons } from "@/components/dashboard/dashboard-widgets";
import { useTranslation } from "@/i18n/provider";
import type { StaffDashboardStats } from "@/lib/reports/types";

const linkClass = "text-[#2F6FB3] hover:text-[#1F4E79] hover:underline";

export function StaffDashboardClient({ stats }: { stats: StaffDashboardStats }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("dashboard.myClients")}
          value={stats.myCustomers}
          hint={t("dashboard.myClientsHint")}
          icon={kpiIcons.users}
        />
        <KpiCard label={t("dashboard.myTasks")} value={stats.myTodayTasks} icon={kpiIcons.clock} />
        <KpiCard
          label={t("dashboard.overdueTasks")}
          value={stats.myOverdueTasks}
          variant="danger"
          icon={kpiIcons.alert}
        />
        <KpiCard
          label={t("dashboard.pendingApprovals")}
          value={stats.myPendingApprovals}
          variant="warning"
          hint={
            <Link href="/approvals" className={linkClass}>
              {t("dashboard.viewMyApprovals")}
            </Link>
          }
          icon={kpiIcons.clipboard}
        />
        <KpiCard
          label={t("dashboard.newClientsThisMonth")}
          value={stats.myNewCustomersThisMonth}
          icon={kpiIcons.users}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label={t("dashboard.myHighChurnRisk")}
          value={stats.myHighChurnRiskCustomers}
          variant="danger"
          hint={
            <Link href="/customers?heat=high_churn_risk" className={linkClass}>
              {t("dashboard.viewClients")}
            </Link>
          }
          icon={kpiIcons.alert}
        />
        <KpiCard
          label={t("dashboard.myLowCompleteness")}
          value={stats.myLowCompletenessCustomers}
          variant="warning"
          hint={
            <Link href="/customers" className={linkClass}>
              {t("dashboard.completenessBelow60")}
            </Link>
          }
          icon={kpiIcons.clipboard}
        />
      </div>
    </div>
  );
}
