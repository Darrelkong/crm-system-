"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import {
  KpiCard,
  kpiIcons,
  RankingTable,
  SimpleBarRow,
} from "@/components/dashboard/dashboard-widgets";
import { RecentFollowUpsList } from "@/components/reports/recent-follow-ups-list";
import { useTranslation } from "@/i18n/provider";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import type { AdminReportsStats } from "@/lib/reports/types";

const linkClass = "text-[#2F6FB3] hover:text-[#1F4E79] hover:underline";

export function AdminReportsClient({ stats }: { stats: AdminReportsStats }) {
  const { t } = useTranslation();
  const { salesStage } = useCustomerLabels();

  const maxStage = Math.max(
    ...stats.customersBySalesStage.map((s) => s.count),
    1,
  );

  const hasAnyData =
    stats.totalCustomers > 0 ||
    stats.followUpsThisMonth > 0 ||
    stats.recentFollowUps.length > 0;

  return (
    <div className="space-y-6">
      <PageIntro
        title={t("reports.title")}
        description={t("reports.adminDescription")}
      />

      {!hasAnyData && (
        <Card className="p-6">
          <p className="text-sm text-[#6B7890]">{t("reports.noData")}</p>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[#172033]">
          {t("reports.customerOverview")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label={t("reports.totalCustomers")}
            value={stats.totalCustomers}
            hint={t("dashboard.excludingArchived")}
            icon={kpiIcons.users}
          />
          <KpiCard
            label={t("reports.newToday")}
            value={stats.newCustomersToday}
            icon={kpiIcons.trend}
          />
          <KpiCard
            label={t("reports.newThisWeek")}
            value={stats.newCustomersThisWeek}
            icon={kpiIcons.trend}
          />
          <KpiCard
            label={t("reports.newThisMonth")}
            value={stats.newCustomersThisMonth}
            icon={kpiIcons.trend}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[#172033]">
          {t("reports.followUpOverview")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label={t("reports.followUpsToday")}
            value={stats.followUpsToday}
            icon={kpiIcons.clipboard}
          />
          <KpiCard
            label={t("reports.followUpsThisWeek")}
            value={stats.followUpsThisWeek}
            icon={kpiIcons.clipboard}
          />
          <KpiCard
            label={t("reports.followUpsThisMonth")}
            value={stats.followUpsThisMonth}
            icon={kpiIcons.clipboard}
          />
          <KpiCard
            label={t("reports.pendingApprovals")}
            value={stats.pendingApprovals}
            variant="warning"
            hint={
              <Link href="/approvals" className={linkClass}>
                {t("dashboard.goToApprovals")}
              </Link>
            }
            icon={kpiIcons.clipboard}
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-sm font-semibold text-[#172033]">
            {t("reports.stageDistribution")}
          </h3>
          {stats.customersBySalesStage.length === 0 ? (
            <p className="text-sm text-[#6B7890]">{t("reports.noStageData")}</p>
          ) : (
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
          )}
        </Card>

        <Card>
          <RankingTable
            title={t("reports.staffCustomerDistribution")}
            columns={[t("dashboard.columnStaff"), t("dashboard.columnClientCount")]}
            rows={stats.customersByOwner.map((o) => ({
              name: o.ownerName,
              count: o.count,
            }))}
            emptyMessage={t("reports.noStaffDistribution")}
          />
        </Card>
      </div>

      <Card>
        <h3 className="mb-4 text-sm font-semibold text-[#172033]">
          {t("reports.recentFollowUps")}
        </h3>
        <RecentFollowUpsList items={stats.recentFollowUps} showStaffName />
      </Card>
    </div>
  );
}
