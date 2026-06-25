"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StaffClaimStatusText } from "@/components/dashboard/staff-claim-status-text";
import { KpiCard } from "@/components/dashboard/dashboard-widgets";
import { useTranslation } from "@/i18n/provider";
import type { StaffDashboardStats } from "@/lib/reports/types";

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
        />
        <KpiCard label={t("dashboard.myTasks")} value={stats.myTodayTasks} />
        <KpiCard
          label={t("dashboard.overdueTasks")}
          value={stats.myOverdueTasks}
          variant="danger"
        />
        <KpiCard
          label={t("dashboard.pendingApprovals")}
          value={stats.myPendingApprovals}
          variant="warning"
          hint={
            <Link href="/approvals" className="text-indigo-600 hover:underline">
              {t("dashboard.viewMyApprovals")}
            </Link>
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("dashboard.newClientsThisMonth")}
          value={stats.myNewCustomersThisMonth}
        />
        <KpiCard
          label={t("dashboard.followUpsThisMonth")}
          value={stats.myFollowUpsThisMonth}
        />
        <KpiCard
          label={t("dashboard.validFollowUpsThisMonth")}
          value={stats.myValidFollowUpsThisMonth}
        />
        <KpiCard
          label={t("dashboard.closedWonClients")}
          value={stats.myClosedWonCustomers}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label={t("dashboard.neverContacted")}
          value={stats.myNeverContactedCustomers}
          variant="warning"
        />
        <KpiCard
          label={t("dashboard.reclaimRisk")}
          value={stats.myReclaimRiskCustomers}
          variant="danger"
          hint={t("dashboard.reclaimRiskHint")}
        />
        <KpiCard
          label={t("dashboard.claimedLast7Days")}
          value={stats.myClaimedFromPoolLast7Days}
          hint={t("dashboard.remainingQuotaHint", {
            remaining: String(claim.remainingQuota),
            limit: String(claim.quotaLimit),
          })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label={t("dashboard.myHighChurnRisk")}
          value={stats.myHighChurnRiskCustomers}
          variant="danger"
          hint={
            <Link
              href="/customers?heat=high_churn_risk"
              className="text-indigo-600 hover:underline"
            >
              {t("dashboard.viewClients")}
            </Link>
          }
        />
        <KpiCard
          label={t("dashboard.myLowCompleteness")}
          value={stats.myLowCompletenessCustomers}
          variant="warning"
          hint={
            <Link
              href="/customers?completenessBelow=60"
              className="text-indigo-600 hover:underline"
            >
              {t("dashboard.completenessBelow60")}
            </Link>
          }
        />
      </div>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">
          {t("dashboard.publicPoolClaimStatus")}
        </h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">{t("publicPool.claimedLast7Days")}</dt>
            <dd className="font-medium text-slate-900">
              {claim.claimedInLast7Days} / {claim.quotaLimit}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t("publicPool.remainingQuota")}</dt>
            <dd className="font-medium text-slate-900">{claim.remainingQuota}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t("dashboard.cooldownHours")}</dt>
            <dd className="font-medium text-slate-900">{claim.cooldownHours}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t("dashboard.canClaimNow")}</dt>
            <dd className="font-medium text-slate-900">
              {claim.canClaimNow ? t("common.yes") : t("common.no")}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t("dashboard.statusNote")}</dt>
            <dd className="text-slate-800">
              <StaffClaimStatusText
                canClaimNow={claim.canClaimNow}
                blockedReasonKey={claim.blockedReasonKey}
                blockedReasonParams={claim.blockedReasonParams}
              />
            </dd>
          </div>
        </dl>
        <Link
          href="/public-pool"
          className="mt-4 inline-block text-sm text-indigo-600 hover:underline"
        >
          {t("dashboard.goToPublicPool")}
        </Link>
      </Card>
    </div>
  );
}
