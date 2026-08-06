"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import type { DashboardTrendsPayload } from "@/lib/reports/dashboard-trends-types";
import {
  selectTrendWindow,
  TREND_RANGE_DAYS,
  type TrendRangeDays,
} from "@/lib/reports/dashboard-trends-period";
import { formatHongKongDate } from "@/lib/timezone";

type Props = {
  trends: DashboardTrendsPayload | null;
  error?: boolean;
};

function formatShortDate(ymd: string, locale: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      timeZone: "Asia/Hong_Kong",
    }).format(new Date(Date.UTC(y, m - 1, d, 4, 0, 0)));
  } catch {
    return `${m}/${d}`;
  }
}

function TrendLineChart({
  points,
  metricLabel,
  locale,
}: {
  points: Array<{ date: string; value: number }>;
  metricLabel: string;
  locale: string;
}) {
  const gradientId = useId().replace(/:/g, "");
  const width = 640;
  const height = 220;
  const padX = 12;
  const padY = 16;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;
  const maxValue = Math.max(...points.map((p) => p.value), 1);

  const coords = points.map((point, index) => {
    const x =
      points.length === 1
        ? padX + chartW / 2
        : padX + (index / (points.length - 1)) * chartW;
    const y = padY + chartH - (point.value / maxValue) * chartH;
    return { ...point, x, y };
  });

  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    coords.length > 0
      ? `${linePath} L${coords[coords.length - 1]!.x.toFixed(1)},${(padY + chartH).toFixed(1)} L${coords[0]!.x.toFixed(1)},${(padY + chartH).toFixed(1)} Z`
      : "";

  const summary = `${metricLabel}: ${points.map((p) => `${formatShortDate(p.date, locale)} ${p.value}`).join("; ")}`;

  return (
    <div className="w-full overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[220px] w-full sm:h-[260px]"
        role="img"
        aria-label={summary}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2F6FB3" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#2F6FB3" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line
          x1={padX}
          y1={padY + chartH}
          x2={padX + chartW}
          y2={padY + chartH}
          stroke="currentColor"
          className="text-slate-200"
          strokeWidth="1"
        />
        {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="#2F6FB3"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {coords.map((c) => (
          <g key={c.date}>
            <circle
              cx={c.x}
              cy={c.y}
              r="4"
              fill="#fff"
              stroke="#2F6FB3"
              strokeWidth="2"
            >
              <title>
                {`${formatShortDate(c.date, locale)} · ${metricLabel}: ${c.value}`}
              </title>
            </circle>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between px-1 text-[10px] crm-text-secondary sm:text-xs">
        <span>{formatShortDate(points[0]?.date ?? "", locale)}</span>
        <span>
          {formatShortDate(points[points.length - 1]?.date ?? "", locale)}
        </span>
      </div>
    </div>
  );
}

export function DashboardTrendsCard({ trends, error = false }: Props) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const [rangeDays, setRangeDays] = useState<TrendRangeDays>(7);
  const [metricKey, setMetricKey] = useState<string | null>(null);

  const activeMetricKey =
    metricKey ?? trends?.defaultMetricKey ?? "valid_follow_ups";
  const metricMeta = trends?.availableMetrics.find(
    (m) => m.key === activeMetricKey,
  );

  const windowData = useMemo(() => {
    const fullSeries = trends?.dailySeries[activeMetricKey] ?? [];
    return selectTrendWindow(fullSeries, rangeDays);
  }, [trends, activeMetricKey, rangeDays]);

  if (error) {
    return (
      <Card className="p-5">
        <h2 className="section-title mb-2">{t("dashboard.trendOverview")}</h2>
        <p className="text-sm crm-text-secondary">
          {t("dashboard.trendUnavailable")}
        </p>
        <button
          type="button"
          className="mt-3 text-sm font-medium text-[#2F6FB3]"
          onClick={() => router.refresh()}
        >
          {t("dashboard.trendReload")}
        </button>
      </Card>
    );
  }

  if (!trends) {
    return (
      <Card className="p-5">
        <div className="mb-4 h-5 w-40 animate-pulse rounded bg-slate-100" />
        <div className="h-[220px] animate-pulse rounded-xl bg-slate-100" />
      </Card>
    );
  }

  const { comparison, current } = windowData;
  const metricLabel = metricMeta
    ? t(metricMeta.labelKey)
    : activeMetricKey;
  const allZero = current.every((p) => p.value === 0);

  let comparisonText = t("dashboard.trendFlat");
  if (comparison.direction === "new_this_period") {
    comparisonText = t("dashboard.trendNewThisPeriod");
  } else if (comparison.direction === "up") {
    comparisonText = t("dashboard.trendIncreased", {
      count: String(comparison.change),
      percent:
        comparison.changePercent == null
          ? ""
          : String(comparison.changePercent),
    });
  } else if (comparison.direction === "down") {
    comparisonText = t("dashboard.trendDecreased", {
      count: String(Math.abs(comparison.change)),
      percent:
        comparison.changePercent == null
          ? ""
          : String(Math.abs(comparison.changePercent)),
    });
  }

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="section-title">{t("dashboard.trendOverview")}</h2>
          <p className="mt-1 text-sm crm-text-secondary">
            {t(`dashboard.trendLast${rangeDays}Days`)}
          </p>
        </div>
        <div
          className="inline-flex rounded-lg border border-slate-200 p-0.5"
          role="group"
          aria-label={t("dashboard.trendOverview")}
        >
          {TREND_RANGE_DAYS.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={rangeDays === days}
              onClick={() => setRangeDays(days)}
              className={`min-h-9 min-w-[3.25rem] rounded-md px-3 text-sm font-medium transition-colors ${
                rangeDays === days
                  ? "bg-[#2F6FB3] text-white"
                  : "crm-text-secondary hover:bg-slate-50"
              }`}
            >
              {t(`dashboard.trendRange${days}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="block min-w-0 flex-1 text-sm">
          <span className="mb-1 block crm-text-secondary">
            {t("dashboard.trendMetricLabel")}
          </span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm crm-text"
            value={activeMetricKey}
            onChange={(event) => setMetricKey(event.target.value)}
          >
            {trends.availableMetrics.map((metric) => (
              <option key={metric.key} value={metric.key}>
                {t(metric.labelKey)}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:text-right">
          <p className="text-3xl font-semibold tabular-nums crm-text">
            {comparison.currentTotal}
          </p>
          <p className="mt-1 text-xs crm-text-secondary">
            {t("dashboard.trendCurrentPeriod")} · {comparisonText}
          </p>
          <p className="text-xs crm-text-secondary">
            {t("dashboard.trendPreviousPeriod")}: {comparison.previousTotal}
          </p>
        </div>
      </div>

      <div className="mt-4">
        {allZero ? (
          <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-slate-200 px-4 text-center text-sm crm-text-secondary sm:h-[260px]">
            {t("dashboard.trendEmptyPeriod")}
          </div>
        ) : (
          <TrendLineChart
            points={current}
            metricLabel={metricLabel}
            locale={locale}
          />
        )}
      </div>

      {!allZero && (
        <p className="mt-2 text-xs crm-text-secondary">
          {t("dashboard.trendTapHint")} ·{" "}
          {formatHongKongDate(current[current.length - 1]?.date ?? null)}
        </p>
      )}
    </Card>
  );
}
