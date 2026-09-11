"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { DashboardSourceDetailSheet } from "@/components/dashboard/dashboard-source-detail-sheet";
import { useTranslation } from "@/i18n/provider";
import type { CountByLabel } from "@/lib/reports/types";

const SEGMENT_COLORS = [
  "#4338ca",
  "#0ea5e9",
  "#7c3aed",
  "#0d9488",
  "#64748b",
] as const;

const OTHER_COLOR = "#94a3b8";
const TOP_SOURCE_COUNT = 5;
const CHART_SIZE = 248;
const CENTER = CHART_SIZE / 2;
const OUTER_RADIUS = 112;
const INNER_RADIUS = 68;
const SEGMENT_GAP_DEG = 1.2;

type DisplaySegment = {
  key: string;
  label: string;
  count: number;
  color: string;
  isOther?: boolean;
};

type SegmentArc = DisplaySegment & {
  startAngle: number;
  endAngle: number;
};

function polarToCartesian(
  center: number,
  radius: number,
  angleDeg: number,
): { x: number; y: number } {
  const radians = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: center + radius * Math.cos(radians),
    y: center + radius * Math.sin(radians),
  };
}

function describeDonutSegment(
  startAngle: number,
  endAngle: number,
): string {
  const startOuter = polarToCartesian(CENTER, OUTER_RADIUS, startAngle);
  const endOuter = polarToCartesian(CENTER, OUTER_RADIUS, endAngle);
  const startInner = polarToCartesian(CENTER, INNER_RADIUS, endAngle);
  const endInner = polarToCartesian(CENTER, INNER_RADIUS, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${INNER_RADIUS} ${INNER_RADIUS} 0 ${largeArc} 0 ${endInner.x} ${endInner.y}`,
    "Z",
  ].join(" ");
}

function buildDisplaySegments(
  sources: CountByLabel[],
  otherLabel: string,
): DisplaySegment[] {
  const sorted = [...sources].sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, TOP_SOURCE_COUNT);
  const rest = sorted.slice(TOP_SOURCE_COUNT);
  const otherCount = rest.reduce((sum, item) => sum + item.count, 0);

  const segments: DisplaySegment[] = top.map((item, index) => ({
    key: item.label,
    label: item.label,
    count: item.count,
    color: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
  }));

  if (otherCount > 0) {
    segments.push({
      key: "__aggregated_other__",
      label: otherLabel,
      count: otherCount,
      color: OTHER_COLOR,
      isOther: true,
    });
  }

  return segments;
}

function buildSegmentArcs(
  segments: DisplaySegment[],
  total: number,
): SegmentArc[] {
  if (total <= 0) return [];

  let currentAngle = 0;
  const gap =
    segments.length > 1 ? SEGMENT_GAP_DEG * segments.length : 0;
  const usableDegrees = 360 - gap;

  return segments.map((segment, index) => {
    const segmentAngle = (segment.count / total) * usableDegrees;
    const startAngle = currentAngle + (index > 0 ? SEGMENT_GAP_DEG : 0);
    const endAngle = startAngle + segmentAngle;
    currentAngle = endAngle;
    return {
      ...segment,
      startAngle,
      endAngle,
    };
  });
}

function formatPercent(count: number, total: number): string {
  if (total <= 0) return "0";
  return ((count / total) * 100).toFixed(1);
}

export function DashboardSourceDistributionDonut({
  sources,
}: {
  sources: CountByLabel[];
}) {
  const { t } = useTranslation();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const otherLabel = t("dashboard.sourceDistributionOther");
  const segments = useMemo(
    () => buildDisplaySegments(sources, otherLabel),
    [otherLabel, sources],
  );
  const total = useMemo(
    () => sources.reduce((sum, item) => sum + item.count, 0),
    [sources],
  );
  const arcs = useMemo(
    () => buildSegmentArcs(segments, total),
    [segments, total],
  );
  const selectedSegment =
    arcs.find((segment) => segment.key === selectedKey) ?? null;

  function handleSegmentSelect(key: string) {
    setSelectedKey((current) => (current === key ? null : key));
  }

  return (
    <>
      <Card className="min-w-0 overflow-hidden p-5">
        <h3 className="section-title mb-3">{t("dashboard.customersBySource")}</h3>

        {total === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm crm-text-secondary">
            {t("dashboard.stageDistributionEmpty")}
          </p>
        ) : (
          <div className="flex flex-col items-center">
            <div className="relative mx-auto w-full max-w-[16.25rem]">
              <svg
                viewBox={`0 0 ${CHART_SIZE} ${CHART_SIZE}`}
                className="mx-auto h-auto w-full max-w-[15.5rem] touch-manipulation sm:max-w-[16.25rem]"
                role="group"
                aria-label={t("dashboard.customersBySource")}
              >
                {arcs.map((segment) => {
                  const isSelected = selectedKey === segment.key;
                  const isDimmed =
                    selectedKey !== null && selectedKey !== segment.key;

                  return (
                    <path
                      key={segment.key}
                      d={describeDonutSegment(
                        segment.startAngle,
                        segment.endAngle,
                      )}
                      fill={segment.color}
                      className="motion-safe:transition-[opacity,filter] motion-safe:duration-200 motion-reduce:transition-none"
                      style={{
                        opacity: isDimmed ? 0.55 : 1,
                        filter: isSelected
                          ? "brightness(1.04) drop-shadow(0 0 0.5px rgba(15,23,42,0.15))"
                          : undefined,
                      }}
                      onClick={() => handleSegmentSelect(segment.key)}
                    />
                  );
                })}
              </svg>

              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                className="absolute inset-[27%] flex flex-col items-center justify-center rounded-full bg-white text-center shadow-inner motion-safe:transition-transform motion-safe:duration-200 motion-reduce:transition-none"
                aria-label={
                  selectedSegment
                    ? t("dashboard.sourceDistributionResetSelection")
                    : t("dashboard.customersBySource")
                }
              >
                {selectedSegment ? (
                  <>
                    <span className="max-w-[5.5rem] truncate text-sm font-semibold leading-tight crm-text">
                      {selectedSegment.label}
                    </span>
                    <span className="mt-1 text-2xl font-bold tabular-nums leading-none crm-text">
                      {selectedSegment.count}
                    </span>
                    <span className="mt-0.5 text-xs font-medium tabular-nums text-slate-500">
                      {formatPercent(selectedSegment.count, total)}%
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-3xl font-bold tabular-nums leading-none crm-text">
                      {total}
                    </span>
                    <span className="mt-1 text-xs font-medium crm-text-secondary">
                      {t("dashboard.sourceDistributionCenterLabel")}
                    </span>
                  </>
                )}
              </button>
            </div>

            <p className="mt-3 text-center text-xs text-slate-400">
              {t("dashboard.sourceDistributionTapHint")}
            </p>

            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="mt-3 text-sm font-medium text-[var(--color-crm-primary)] hover:underline"
            >
              {t("dashboard.sourceDistributionViewDetails")}
            </button>
          </div>
        )}
      </Card>

      <DashboardSourceDetailSheet
        open={detailsOpen}
        title={t("dashboard.customersBySource")}
        closeLabel={t("common.close")}
        onClose={() => setDetailsOpen(false)}
      >
        <ul className="space-y-2">
          {[...sources]
            .sort((a, b) => b.count - a.count)
            .map((item) => (
              <li
                key={item.label}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5 text-sm"
              >
                <span className="min-w-0 break-words crm-text">{item.label}</span>
                <span className="shrink-0 font-semibold tabular-nums crm-text">
                  {item.count}
                </span>
              </li>
            ))}
        </ul>
      </DashboardSourceDetailSheet>
    </>
  );
}
