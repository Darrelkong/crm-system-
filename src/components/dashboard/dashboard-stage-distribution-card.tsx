"use client";

import Link from "next/link";
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
  const isEmpty = distribution.totalCustomers === 0;

  return (
    <Card className="min-w-0 overflow-hidden p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="section-title">{t(distribution.titleKey)}</h2>
          <p className="mt-1 text-sm crm-text-secondary">
            {t("dashboard.stageDistributionCustomers", {
              count: String(distribution.totalCustomers),
            })}
          </p>
        </div>
      </div>

      {isEmpty ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm crm-text-secondary">
          {t("dashboard.stageDistributionEmpty")}
        </p>
      ) : (
        <>
          <div
            className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-slate-100"
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

          <ul className="mt-4 space-y-2">
            {distribution.stages.map((stage) => {
              const label = resolveStageLabel(stage.labelKey, t, salesStage);
              const row = (
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${getSalesStageBadgeClass(stage.tone)}`}
                    >
                      {label}
                    </span>
                    <span className="text-sm crm-text-secondary">
                      {t("dashboard.stageDistributionShare", {
                        percent: String(stage.percentage),
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 sm:justify-end">
                    <div className="h-1.5 w-full max-w-[8rem] rounded-full bg-slate-100 sm:w-28">
                      <div
                        className={`h-full rounded-full ${getSalesStageBadgeClass(stage.tone)}`}
                        style={{ width: `${Math.max(stage.percentage, 0)}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums crm-text">
                      {stage.count}
                    </span>
                  </div>
                </div>
              );

              return (
                <li key={stage.key} className="rounded-lg border border-slate-100 px-3 py-2.5">
                  {stage.href ? (
                    <Link
                      href={stage.href}
                      className="block transition-colors hover:bg-slate-50/80"
                    >
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
