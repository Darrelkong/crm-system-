"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StaffClaimStatusText } from "@/components/dashboard/staff-claim-status-text";
import { KpiCard, kpiIcons } from "@/components/dashboard/dashboard-widgets";
import { useTranslation } from "@/i18n/provider";
import type { StaffDashboardStats } from "@/lib/reports/types";

const linkClass = "text-[#2F6FB3] hover:text-[#1F4E79] hover:underline";

export function StaffDashboardClient({ stats }: { stats: StaffDashboardStats }) {
  const { t } = useTranslation();
  const claim = stats.publicPoolClaimStatus;

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
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("dashboard.newClientsThisMonth")}
          value={stats.myNewCustomersThisMonth}
          icon={kpiIcons.users}
        />
        <KpiCard
          label={t("dashboard.followUpsThisMonth")}
          value={stats.myFollowUpsThisMonth}
          icon={kpiIcons.clipboard}
        />
        <KpiCard
          label={t("dashboard.validFollowUpsThisMonth")}
          value={stats.myValidFollowUpsThisMonth}
          icon={kpiIcons.trend}
        />
        <KpiCard
          label={t("dashboard.closedWonClients")}
          value={stats.myClosedWonCustomers}
          icon={kpiIcons.trend}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label={t("dashboard.neverContacted")}
          value={stats.myNeverContactedCustomers}
          variant="warning"
          icon={kpiIcons.alert}
        />
        <KpiCard
          label={t("dashboard.reclaimRisk")}
          value={stats.myReclaimRiskCustomers}
          variant="danger"
          hint={t("dashboard.reclaimRiskHint")}
          icon={kpiIcons.alert}
        />
        <KpiCard
          label={t("dashboard.claimedLast7Days")}
          value={stats.myClaimedFromPoolLast7Days}
          hint={t("dashboard.remainingQuotaHint", {
            remaining: String(claim.remainingQuota),
            limit: String(claim.quotaLimit),
          })}
          icon={kpiIcons.waves}
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
            <Link href="/customers?completenessBelow=60" className={linkClass}>
              {t("dashboard.completenessBelow60")}
            </Link>
          }
          icon={kpiIcons.clipboard}
        />
      </div>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-[#172033]">
          {t("dashboard.publicPoolClaimStatus")}
        </h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[#6B7890]">{t("publicPool.claimedLast7Days")}</dt>
            <dd className="font-medium text-[#172033]">
              {claim.claimedInLast7Days} / {claim.quotaLimit}
            </dd>
          </div>
          <div>
            <dt className="text-[#6B7890]">{t("publicPool.remainingQuota")}</dt>
            <dd className="font-medium text-[#172033]">{claim.remainingQuota}</dd>
          </div>
          <div>
            <dt className="text-[#6B7890]">{t("dashboard.cooldownHours")}</dt>
            <dd className="font-medium text-[#172033]">{claim.cooldownHours}</dd>
          </div>
          <div>
            <dt className="text-[#6B7890]">{t("dashboard.canClaimNow")}</dt>
            <dd className="font-medium text-[#172033]">
              {claim.canClaimNow ? t("common.yes") : t("common.no")}
            </dd>
          </div>
          <div>
            <dt className="text-[#6B7890]">{t("dashboard.statusNote")}</dt>
            <dd className="text-[#172033]">
              <StaffClaimStatusText
                canClaimNow={claim.canClaimNow}
                blockedReasonKey={claim.blockedReasonKey}
                blockedReasonParams={claim.blockedReasonParams}
              />
            </dd>
          </div>
        </dl>
        <Link href="/public-pool" className={`mt-4 inline-block text-sm ${linkClass}`}>
          {t("dashboard.goToPublicPool")}
        </Link>
      </Card>
    </div>
  );
}
