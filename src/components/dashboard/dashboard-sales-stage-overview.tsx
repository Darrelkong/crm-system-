"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { getSalesStageBadgeClass } from "@/lib/customers/sales-stage-badges";
import type { CountByLabel } from "@/lib/reports/types";

type StageDisplayRow = CountByLabel & {
  labelText: string;
  percentage: number;
};

function buildStageRows(
  stages: CountByLabel[],
  salesStage: (key: string) => string,
): StageDisplayRow[] {
  const total = stages.reduce((sum, item) => sum + item.count, 0);

  return stages.map((item) => ({
    ...item,
    labelText: salesStage(item.label),
    percentage: total > 0 ? Math.round((item.count / total) * 100) : 0,
  }));
}

export function DashboardSalesStageOverview({
  stages,
}: {
  stages: CountByLabel[];
}) {
  const { t } = useTranslation();
  const { salesStage } = useCustomerLabels();
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(
    () => buildStageRows(stages, salesStage),
    [salesStage, stages],
  );
  const nonZeroRows = rows.filter((row) => row.count > 0);
  const zeroRows = rows.filter((row) => row.count === 0);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const visibleRows = expanded ? rows : nonZeroRows;

  return (
    <Card className="min-w-0 overflow-hidden p-5">
      <h3 className="section-title mb-4">{t("dashboard.customersBySalesStage")}</h3>

      {total === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm crm-text-secondary">
          {t("dashboard.stageDistributionEmpty")}
        </p>
      ) : (
        <>
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 motion-safe:transition-all motion-safe:duration-500"
            role="img"
            aria-label={t("dashboard.customersBySalesStage")}
          >
            {nonZeroRows.map((row) => (
              <div
                key={row.label}
                className={`h-full ${getSalesStageBadgeClass(row.label)}`}
                style={{
                  width: `${row.percentage}%`,
                  minWidth: row.percentage > 0 ? "2px" : undefined,
                }}
                title={`${row.labelText} ${row.count}`}
              />
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {visibleRows.map((row) => (
              <div
                key={row.label}
                className="rounded-xl border border-slate-100 px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex max-w-[70%] truncate rounded-full px-2 py-0.5 text-xs font-medium ${getSalesStageBadgeClass(row.label)}`}
                  >
                    {row.labelText}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums crm-text">
                    {row.count}
                  </span>
                </div>
                <p className="mt-1 text-xs crm-text-secondary">
                  {t("dashboard.stageDistributionShare", {
                    percent: String(row.percentage),
                  })}
                </p>
              </div>
            ))}
          </div>

          {zeroRows.length > 0 ? (
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
