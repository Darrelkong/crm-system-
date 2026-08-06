"use client";

import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import type { DashboardTrendsPayload } from "@/lib/reports/dashboard-trends-types";
import {
  selectTrendWindow,
  TREND_RANGE_DAYS,
  type DailyPoint,
  type TrendRangeDays,
} from "@/lib/reports/dashboard-trends-period";
import {
  buildTrendChartCoords,
  clampTrendIndex,
  formatTrendAxisDate,
  formatTrendTooltipDate,
  getTrendTooltipSide,
  moveTrendIndex,
  nearestTrendIndexFromClientX,
  TREND_CHART_HEIGHT,
  TREND_CHART_PAD_X,
  TREND_CHART_PAD_Y,
  TREND_CHART_WIDTH,
} from "@/lib/reports/dashboard-trends-interaction";

type Props = {
  trends: DashboardTrendsPayload | null;
  error?: boolean;
};

function TrendLineChart({
  points,
  metricLabel,
  rangeDays,
  locale,
  t,
}: {
  points: DailyPoint[];
  metricLabel: string;
  rangeDays: TrendRangeDays;
  locale: string;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const gradientId = useId().replace(/:/g, "");
  const chartRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const pointerTypeRef = useRef<string>("mouse");

  const width = TREND_CHART_WIDTH;
  const height = TREND_CHART_HEIGHT;
  const padX = TREND_CHART_PAD_X;
  const padY = TREND_CHART_PAD_Y;
  const chartH = height - padY * 2;

  const coords = useMemo(() => buildTrendChartCoords(points), [points]);

  const active =
    activeIndex == null
      ? null
      : (coords[clampTrendIndex(activeIndex, coords.length)] ?? null);
  const chartAria = t("dashboard.trendChartAriaLabel", {
    metric: metricLabel,
    days: String(rangeDays),
  });
  const liveValue =
    active == null
      ? chartAria
      : t("dashboard.trendTooltipLive", {
          date: formatTrendTooltipDate(active.date, locale),
          metric: metricLabel,
          value: String(Math.round(active.value)),
        });

  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    coords.length > 0
      ? `${linePath} L${coords[coords.length - 1]!.x.toFixed(1)},${(padY + chartH).toFixed(1)} L${coords[0]!.x.toFixed(1)},${(padY + chartH).toFixed(1)} Z`
      : "";

  function selectFromClientX(clientX: number) {
    const el = chartRef.current;
    if (!el || points.length === 0) return;
    const rect = el.getBoundingClientRect();
    setActiveIndex(
      nearestTrendIndexFromClientX(clientX, rect, points.length, padX, width),
    );
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    pointerTypeRef.current = event.pointerType;
    if (event.pointerType === "mouse") {
      selectFromClientX(event.clientX);
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    pointerTypeRef.current = event.pointerType;
    selectFromClientX(event.clientX);
  }

  function onPointerLeave() {
    if (pointerTypeRef.current === "mouse") {
      setActiveIndex(null);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (points.length === 0) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveIndex((prev) => moveTrendIndex(prev, points.length, -1));
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setActiveIndex((prev) => moveTrendIndex(prev, points.length, 1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(points.length - 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setActiveIndex(null);
    }
  }

  function onFocus() {
    if (activeIndex == null && points.length > 0) {
      setActiveIndex(points.length - 1);
    }
  }

  const tooltipSide =
    active == null ? "start" : getTrendTooltipSide(active.index, points.length);
  const tooltipLeftPercent =
    active == null ? 50 : (active.x / width) * 100;

  return (
    <div className="w-full min-w-0 overflow-hidden">
      <div
        ref={chartRef}
        tabIndex={0}
        role="group"
        aria-label={chartAria}
        aria-describedby={`${gradientId}-hint`}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End Escape"
        className="relative touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-[#2F6FB3]/40 focus-visible:ring-offset-2"
        style={{ touchAction: "pan-y" }}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-[220px] w-full sm:h-[260px]"
          role="img"
          aria-hidden="true"
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
            x2={padX + (width - padX * 2)}
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
          {active && (
            <line
              x1={active.x}
              y1={padY}
              x2={active.x}
              y2={padY + chartH}
              stroke="#94A3B8"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          )}
          {coords.map((c) => {
            const isActive = active?.index === c.index;
            return (
              <circle
                key={c.date}
                cx={c.x}
                cy={c.y}
                r={isActive ? 6 : points.length <= 14 ? 3.5 : 0}
                fill={isActive ? "#2F6FB3" : "#fff"}
                stroke="#2F6FB3"
                strokeWidth={isActive ? 2.5 : 1.5}
                opacity={points.length > 14 && !isActive ? 0 : 1}
              >
                <title>
                  {`${formatTrendTooltipDate(c.date, locale)} · ${metricLabel}: ${Math.round(c.value)}`}
                </title>
              </circle>
            );
          })}
          {active && (
            <circle
              cx={active.x}
              cy={active.y}
              r="6"
              fill="#2F6FB3"
              stroke="#fff"
              strokeWidth="2"
            />
          )}
        </svg>

        {active && (
          <div
            className="pointer-events-none absolute top-2 z-10 max-w-[min(100%,14rem)] rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-sm backdrop-blur-sm"
            style={{
              left: `${tooltipLeftPercent}%`,
              transform:
                tooltipSide === "end" ? "translateX(-100%)" : "translateX(0)",
            }}
            data-testid="trend-tooltip"
            data-side={tooltipSide}
          >
            <p className="font-medium crm-text break-words">
              {formatTrendTooltipDate(active.date, locale)}
            </p>
            <p className="mt-0.5 crm-text-secondary break-words">
              {metricLabel}: {Math.round(active.value)}
            </p>
          </div>
        )}
      </div>

      <div className="mt-1 flex justify-between px-1 text-[10px] crm-text-secondary sm:text-xs">
        <span>{formatTrendAxisDate(points[0]?.date ?? "", locale)}</span>
        <span>
          {formatTrendAxisDate(points[points.length - 1]?.date ?? "", locale)}
        </span>
      </div>

      <p id={`${gradientId}-hint`} className="sr-only">
        {t("dashboard.trendKeyboardHint")}
      </p>
      <p className="sr-only" aria-live="polite">
        {liveValue}
      </p>
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
    <Card className="min-w-0 overflow-hidden p-5">
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

      <div className="mt-4 min-w-0">
        {allZero && (
          <p className="mb-2 text-center text-sm crm-text-secondary">
            {t("dashboard.trendEmptyPeriod")}
          </p>
        )}
        <TrendLineChart
          key={`${rangeDays}:${activeMetricKey}`}
          points={current}
          metricLabel={metricLabel}
          rangeDays={rangeDays}
          locale={locale}
          t={t}
        />
      </div>

      <p className="mt-2 text-xs crm-text-secondary">
        {t("dashboard.trendTapHint")} · {t("dashboard.trendKeyboardHint")}
      </p>
    </Card>
  );
}
