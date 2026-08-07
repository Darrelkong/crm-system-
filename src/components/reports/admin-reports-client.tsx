"use client";

import Link from "next/link";
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
import type { AdminReportsStats } from "@/lib/reports/types";

const linkClass = "text-[#2F6FB3] hover:text-[#1F4E79] hover:underline";
const kpiGridClass = "grid grid-cols-2 gap-3 lg:grid-cols-4";

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
    <div className="space-y-5">
      <PageIntro
        compact
        title={t("reports.title")}
        description={t("reports.adminDescription")}
      />

      <div
        className="surface-muted flex gap-2.5 rounded-xl px-3 py-2.5 text-xs leading-relaxed crm-text-secondary"
        data-reports-scope-note
      >
        <Info
          className="mt-0.5 h-4 w-4 shrink-0 opacity-80"
          aria-hidden
        />
        <p>{t("reports.scopeNoteAdmin")}</p>
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
          {t("reports.customerOverview")}
        </h2>
        <div className={kpiGridClass} data-reports-kpi-grid>
          <KpiCard
            compact
            label={t("reports.totalCustomers")}
            value={stats.totalCustomers}
            hint={t("dashboard.excludingArchived")}
            icon={kpiIcons.users}
          />
          <KpiCard
            compact
            label={t("reports.newToday")}
            value={stats.newCustomersToday}
            icon={kpiIcons.trend}
          />
          <KpiCard
            compact
            label={t("reports.newThisWeek")}
            value={stats.newCustomersThisWeek}
            icon={kpiIcons.trend}
          />
          <KpiCard
            compact
            label={t("reports.newThisMonth")}
            value={stats.newCustomersThisMonth}
            icon={kpiIcons.trend}
          />
        </div>
      </section>

      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold text-[#172033]">
          {t("reports.followUpOverview")}
        </h2>
        <div className={kpiGridClass} data-reports-kpi-grid>
          <KpiCard
            compact
            label={t("reports.followUpsToday")}
            value={stats.followUpsToday}
            icon={kpiIcons.clipboard}
          />
          <KpiCard
            compact
            label={t("reports.followUpsThisWeek")}
            value={stats.followUpsThisWeek}
            icon={kpiIcons.clipboard}
          />
          <KpiCard
            compact
            label={t("reports.followUpsThisMonth")}
            value={stats.followUpsThisMonth}
            icon={kpiIcons.clipboard}
          />
          <KpiCard
            compact
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

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
        <Card className="p-4 sm:p-5">
          <h3 className="mb-3 text-sm font-semibold text-[#172033]">
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

        <Card className="p-4 sm:p-5" data-reports-staff-distribution>
          <h3 className="mb-3 text-sm font-semibold text-[#172033]">
            {t("reports.staffCustomerDistribution")}
          </h3>
          {stats.customersByOwner.length === 0 ? (
            <p className="text-sm text-[#6B7890]">
              {t("reports.noStaffDistribution")}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="pb-2.5 text-xs font-semibold uppercase tracking-wide text-[#6B7890]">
                    {t("dashboard.columnStaff")}
                  </th>
                  <th className="pb-2.5 text-right text-xs font-semibold uppercase tracking-wide text-[#6B7890]">
                    {t("dashboard.columnClientCount")}
                  </th>
                </tr>
              </thead>
              <tbody className="crm-divide-y divide-y">
                {stats.customersByOwner.map((owner) => (
                  <tr key={owner.ownerId}>
                    <td className="min-w-0 py-2.5 break-words text-[#172033]">
                      {owner.ownerName}
                    </td>
                    <td className="py-2.5 text-right font-semibold tabular-nums whitespace-nowrap text-[#172033]">
                      {owner.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card className="p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-semibold text-[#172033]">
          {t("reports.recentFollowUps")}
        </h3>
        <RecentFollowUpsList items={stats.recentFollowUps} showStaffName />
      </Card>
    </div>
  );
}
