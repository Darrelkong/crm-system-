"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { getSalesStageBadgeClass } from "@/lib/customers/sales-stage-badges";
import type { DashboardStageDistributionPayload } from "@/lib/reports/dashboard-stage-distribution-types";

type Props = {
  distribution: DashboardStageDistributionPayload | null;
  error?: boolean;
};

function resolveStageLabel(
  labelKey: string,
  t: (key: string) => string,
  salesStage: (key: string) => string,
): string {
  if (labelKey.startsWith("salesStages.")) {
    return salesStage(labelKey.replace("salesStages.", ""));
  }
  return t(labelKey);
}

export function DashboardStageDistributionCard({
  distribution,
  error = false,
}: Props) {
  const { t } = useTranslation();
  const { salesStage } = useCustomerLabels();
  const [expanded, setExpanded] = useState(false);

  if (error) {
    return (
      <Card className="p-5">
        <h2 className="section-title mb-2">
          {t("dashboard.stageDistributionTitle")}
        </h2>
        <p className="text-sm crm-text-secondary">
          {t("dashboard.stageDistributionUnavailable")}
        </p>
      </Card>
    );
  }

  if (!distribution) {
    return (
      <Card className="p-5">
        <div className="mb-4 h-5 w-48 animate-pulse rounded bg-slate-100" />
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      </Card>
    );
  }

  const nonZeroStages = distribution.stages.filter((stage) => stage.count > 0);
  const zeroStages = distribution.stages.filter((stage) => stage.count === 0);
  const visibleStages = expanded ? distribution.stages : nonZeroStages;
  const isEmpty = distribution.totalCustomers === 0;
  const countLabel =
    distribution.role === "admin"
      ? t("dashboard.stageDistributionPrivateActiveCustomers", {
          count: String(distribution.totalCustomers),
        })
      : t("dashboard.stageDistributionMyPrivateActiveCustomers", {
          count: String(distribution.totalCustomers),
        });

  return (
    <Card className="min-w-0 overflow-hidden p-5">
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="section-title">{t(distribution.titleKey)}</h2>
          <p className="mt-1 break-words text-sm crm-text-secondary">
            {countLabel}
          </p>
          {distribution.role === "admin" ? (
            <p className="mt-1 break-words text-xs leading-relaxed crm-text-secondary">
              {t("dashboard.stageDistributionScopeHint")}
            </p>
          ) : null}
        </div>
      </div>

      {isEmpty ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm crm-text-secondary">
          {t("dashboard.stageDistributionEmpty")}
        </p>
      ) : (
        <>
          <div
            className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-slate-100 motion-safe:transition-all motion-safe:duration-500"
            role="img"
            aria-label={t("dashboard.stageDistributionTitle")}
          >
            {nonZeroStages.map((stage) => (
              <div
                key={stage.key}
                className={`h-full ${getSalesStageBadgeClass(stage.tone)}`}
                style={{
                  width: `${stage.percentage}%`,
                  minWidth: stage.percentage > 0 ? "2px" : undefined,
                }}
                title={`${resolveStageLabel(stage.labelKey, t, salesStage)} ${stage.count}`}
              />
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {visibleStages.map((stage) => {
              const label = resolveStageLabel(stage.labelKey, t, salesStage);
              const chip = (
                <div className="h-full rounded-xl border border-slate-100 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex max-w-[72%] truncate rounded-full px-2 py-0.5 text-xs font-medium ${getSalesStageBadgeClass(stage.tone)}`}
                    >
                      {label}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums crm-text">
                      {stage.count}
                    </span>
                  </div>
                  <p className="mt-1 text-xs crm-text-secondary">
                    {t("dashboard.stageDistributionShare", {
                      percent: String(stage.percentage),
                    })}
                  </p>
                </div>
              );

              return stage.href ? (
                <Link
                  key={stage.key}
                  href={stage.href}
                  className="block transition-colors hover:bg-slate-50/80"
                >
                  {chip}
                </Link>
              ) : (
                <div key={stage.key}>{chip}</div>
              );
            })}
          </div>

          {zeroStages.length > 0 ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="text-sm font-medium text-[var(--color-crm-primary)] hover:underline"
              >
                {expanded
                  ? t("common.collapse")
                  : t("dashboard.viewAllStages")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
