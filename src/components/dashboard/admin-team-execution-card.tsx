"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import type { AdminTeamExecutionOverview } from "@/lib/reports/admin-team-execution";
import {
  TREND_RANGE_DAYS,
  type TrendRangeDays,
} from "@/lib/reports/dashboard-trends-period";
import { buildTeamValidFollowUpsHref } from "@/lib/reports/dashboard-drilldown-links";

type Props = {
  overview: AdminTeamExecutionOverview | null;
  error?: boolean;
};

export function AdminTeamExecutionCard({ overview, error = false }: Props) {
  const { t } = useTranslation();
  const [periodDays, setPeriodDays] = useState<TrendRangeDays>(7);

  if (error) {
    return (
      <Card className="p-5">
        <h2 className="section-title mb-2">
          {t("dashboard.teamExecutionOverview")}
        </h2>
        <p className="text-sm crm-text-secondary">
          {t("dashboard.teamExecutionUnavailable")}
        </p>
      </Card>
    );
  }

  if (!overview) {
    return (
      <Card className="p-5">
        <div className="mb-4 h-5 w-48 animate-pulse rounded bg-slate-100" />
        <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
      </Card>
    );
  }

  const isEmpty = overview.members.length === 0;

  return (
    <Card className="min-w-0 overflow-hidden p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="section-title">
            {t("dashboard.teamExecutionOverview")}
          </h2>
          <p className="mt-1 text-sm crm-text-secondary">
            {t(`dashboard.teamExecutionLast${periodDays}Days`)}
          </p>
        </div>
        <div
          className="inline-flex rounded-lg border border-slate-200 p-0.5"
          role="group"
          aria-label={t("dashboard.teamExecutionReportingPeriod")}
        >
          {TREND_RANGE_DAYS.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={periodDays === days}
              onClick={() => setPeriodDays(days)}
              className={`min-h-9 min-w-[3.25rem] rounded-md px-3 text-sm font-medium transition-colors ${
                periodDays === days
                  ? "bg-[#2F6FB3] text-white"
                  : "crm-text-secondary hover:bg-slate-50"
              }`}
            >
              {t(`dashboard.trendRange${days}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs crm-text-secondary">
        <span>{t("dashboard.teamExecutionPeriodActivity")}</span>
        <span>{t("dashboard.teamExecutionCurrentStatus")}</span>
      </div>

      {isEmpty ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm crm-text-secondary">
          {t("dashboard.teamExecutionEmpty")}
        </p>
      ) : (
        <>
          <div className="mt-4 hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs crm-text-secondary">
                  <th className="px-2 py-2 font-medium">
                    {t("dashboard.teamExecutionMember")}
                  </th>
                  <th className="px-2 py-2 font-medium">
                    {t("dashboard.teamExecutionCurrentCustomers")}
                  </th>
                  <th className="px-2 py-2 font-medium">
                    {t("dashboard.teamExecutionValidFollowUps")}
                  </th>
                  {overview.showStageProgress && (
                    <th className="px-2 py-2 font-medium">
                      {t("dashboard.teamExecutionStageProgress")}
                    </th>
                  )}
                  <th className="px-2 py-2 font-medium">
                    {t("dashboard.teamExecutionOverdue")}
                  </th>
                  <th className="px-2 py-2 font-medium">
                    {t("dashboard.teamExecutionAutoRelease7d")}
                  </th>
                  <th className="px-2 py-2 font-medium">
                    {t("dashboard.teamExecutionPendingItems")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.members.map((member) => {
                  const activity = member.periodActivity[periodDays];
                  return (
                    <tr
                      key={member.userId}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="px-2 py-3 font-medium crm-text">
                        {member.displayName}
                      </td>
                      <td className="px-2 py-3 tabular-nums">
                        <MetricLink href={member.customersHref} value={member.currentCustomers} />
                      </td>
                      <td className="px-2 py-3 tabular-nums">
                        <MetricLink
                          href={buildTeamValidFollowUpsHref(
                            member.userId,
                            periodDays,
                          )}
                          value={activity.validFollowUps}
                        />
                      </td>
                      {overview.showStageProgress && (
                        <td className="px-2 py-3 tabular-nums">
                          {activity.stageProgressCustomers}
                        </td>
                      )}
                      <td className="px-2 py-3 tabular-nums">
                        <MetricLink
                          href={member.overdueHref}
                          value={member.overdueFollowUps}
                          warn={member.overdueFollowUps > 0}
                        />
                      </td>
                      <td className="px-2 py-3 tabular-nums">
                        <MetricLink
                          href={member.reclamationHref}
                          value={member.autoReleaseWithin7Days}
                          warn={member.autoReleaseWithin7Days > 0}
                        />
                      </td>
                      <td className="px-2 py-3 tabular-nums">
                        {member.pendingItems}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 space-y-3 lg:hidden">
            {overview.members.map((member) => {
              const activity = member.periodActivity[periodDays];
              return (
                <div
                  key={member.userId}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <p className="font-medium crm-text">{member.displayName}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <MetricBlock
                      label={t("dashboard.teamExecutionValidFollowUps")}
                      value={activity.validFollowUps}
                      hint={t("dashboard.teamExecutionPeriodActivity")}
                      href={buildTeamValidFollowUpsHref(
                        member.userId,
                        periodDays,
                      )}
                    />
                    {overview.showStageProgress && (
                      <MetricBlock
                        label={t("dashboard.teamExecutionStageProgress")}
                        value={activity.stageProgressCustomers}
                        hint={t("dashboard.teamExecutionPeriodActivity")}
                      />
                    )}
                    <MetricBlock
                      label={t("dashboard.teamExecutionCurrentCustomers")}
                      value={member.currentCustomers}
                      hint={t("dashboard.teamExecutionCurrentStatus")}
                      href={member.customersHref}
                    />
                    <MetricBlock
                      label={t("dashboard.teamExecutionOverdue")}
                      value={member.overdueFollowUps}
                      hint={t("dashboard.teamExecutionCurrentStatus")}
                      href={member.overdueHref}
                      warn={member.overdueFollowUps > 0}
                    />
                    <MetricBlock
                      label={t("dashboard.teamExecutionAutoRelease7d")}
                      value={member.autoReleaseWithin7Days}
                      hint={t("dashboard.teamExecutionCurrentStatus")}
                      href={member.reclamationHref}
                      warn={member.autoReleaseWithin7Days > 0}
                    />
                    <MetricBlock
                      label={t("dashboard.teamExecutionPendingItems")}
                      value={member.pendingItems}
                      hint={t("dashboard.teamExecutionCurrentStatus")}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

function MetricLink({
  href,
  value,
  warn = false,
}: {
  href: string;
  value: number;
  warn?: boolean;
}) {
  if (value <= 0) {
    return <span>{value}</span>;
  }
  return (
    <Link
      href={href}
      className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6FB3] focus-visible:ring-offset-2 ${
        warn ? "text-amber-700 hover:underline" : "text-[#2F6FB3] hover:underline"
      }`}
    >
      {value}
    </Link>
  );
}

function MetricBlock({
  label,
  value,
  hint,
  href,
  warn = false,
}: {
  label: string;
  value: number;
  hint: string;
  href?: string;
  warn?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs crm-text-secondary">{label}</p>
      <p className="mt-0.5 text-[10px] crm-text-secondary">{hint}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          warn ? "text-amber-700" : "crm-text"
        }`}
      >
        {href && value > 0 ? (
          <Link
            href={href}
            className={`hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6FB3] focus-visible:ring-offset-2 ${
              warn ? "text-amber-700" : ""
            }`}
          >
            {value}
          </Link>
        ) : (
          value
        )}
      </p>
    </div>
  );
}
