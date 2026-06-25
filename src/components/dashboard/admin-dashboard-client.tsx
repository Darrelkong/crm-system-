"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import {
  KpiCard,
  RankingTable,
  SimpleBarRow,
} from "@/components/dashboard/dashboard-widgets";
import { useTranslation } from "@/i18n/provider";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import type { AdminDashboardStats } from "@/lib/reports/types";

export function AdminDashboardClient({ stats }: { stats: AdminDashboardStats }) {
  const { t } = useTranslation();
  const { source, salesStage } = useCustomerLabels();

  const maxSource = Math.max(...stats.customersBySource.map((s) => s.count), 1);
  const maxStage = Math.max(
    ...stats.customersBySalesStage.map((s) => s.count),
    1,
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("dashboard.totalClients")}
          value={stats.totalCustomers}
          hint={t("dashboard.excludingArchived")}
        />
        <KpiCard label={t("dashboard.activeClients")} value={stats.activeCustomers} />
        <KpiCard
          label={t("dashboard.publicPool")}
          value={stats.publicPoolCustomers}
          hint={
            <Link href="/public-pool" className="text-indigo-600 hover:underline">
              {t("dashboard.viewPublicPool")}
            </Link>
          }
        />
        <KpiCard label={t("dashboard.archivedClients")} value={stats.archivedCustomers} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("dashboard.pendingApprovals")}
          value={stats.pendingApprovals}
          variant="warning"
          hint={
            <Link href="/approvals" className="text-indigo-600 hover:underline">
              {t("dashboard.goToApprovals")}
            </Link>
          }
        />
        <KpiCard label={t("dashboard.todayTasks")} value={stats.todayOpenTasks} />
        <KpiCard
          label={t("dashboard.overdueTasks")}
          value={stats.overdueTasks}
          variant="danger"
        />
        <KpiCard label={t("dashboard.closedWonClients")} value={stats.closedWonCustomers} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("dashboard.newClientsThisMonth")}
          value={stats.newCustomersThisMonth}
        />
        <KpiCard
          label={t("dashboard.followUpsThisMonth")}
          value={stats.followUpsThisMonth}
        />
        <KpiCard
          label={t("dashboard.validFollowUpsThisMonth")}
          value={stats.validFollowUpsThisMonth}
        />
        <KpiCard
          label={t("dashboard.autoReclaimedThisMonth")}
          value={stats.autoReclaimedThisMonth}
          hint={t("dashboard.auditLogStats")}
        />
        <KpiCard
          label={t("dashboard.highChurnRiskClients")}
          value={stats.highChurnRiskCustomers}
          variant="danger"
          hint={
            <Link
              href="/customers?heat=high_churn_risk"
              className="text-indigo-600 hover:underline"
            >
              {t("dashboard.viewList")}
            </Link>
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("dashboard.lowCompletenessClients")}
          value={stats.lowCompletenessCustomers}
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-sm font-semibold text-slate-900">
            {t("dashboard.customersBySource")}
          </h3>
          <div className="space-y-3">
            {stats.customersBySource.map((item) => (
              <SimpleBarRow
                key={item.label}
                label={source(item.label)}
                count={item.count}
                max={maxSource}
              />
            ))}
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 text-sm font-semibold text-slate-900">
            {t("dashboard.customersBySalesStage")}
          </h3>
          <div className="space-y-3">
            {stats.customersBySalesStage.map((item) => (
              <SimpleBarRow
                key={item.label}
                label={salesStage(item.label)}
                count={item.count}
                max={maxStage}
              />
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <RankingTable
            title={t("dashboard.staffClientRanking")}
            columns={[t("dashboard.columnStaff"), t("dashboard.columnClientCount")]}
            rows={stats.customersByOwner.map((o) => ({
              name: o.ownerName,
              count: o.count,
            }))}
            emptyMessage={t("dashboard.noData")}
          />
        </Card>

        <Card>
          <RankingTable
            title={t("dashboard.staffFollowUpRanking")}
            columns={[t("dashboard.columnStaff"), t("dashboard.columnFollowUpCount")]}
            rows={stats.followUpsByStaffThisMonth.map((s) => ({
              name: s.userName,
              count: s.count,
            }))}
            emptyMessage={t("dashboard.noData")}
          />
        </Card>
      </div>
    </div>
  );
}
