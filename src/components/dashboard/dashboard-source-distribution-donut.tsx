"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import type { CountByLabel } from "@/lib/reports/types";

const SEGMENT_COLORS = [
  "#4f46e5",
  "#0ea5e9",
  "#7c3aed",
  "#64748b",
  "#10b981",
  "#d97706",
] as const;

const OTHER_COLOR = "#94a3b8";
const TOP_SOURCE_COUNT = 5;

type DisplaySegment = {
  label: string;
  count: number;
  color: string;
  isOther?: boolean;
};

function buildDisplaySegments(
  sources: CountByLabel[],
  otherLabel: string,
): DisplaySegment[] {
  const sorted = [...sources].sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, TOP_SOURCE_COUNT);
  const rest = sorted.slice(TOP_SOURCE_COUNT);
  const otherCount = rest.reduce((sum, item) => sum + item.count, 0);

  const segments: DisplaySegment[] = top.map((item, index) => ({
    label: item.label,
    count: item.count,
    color: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
  }));

  if (otherCount > 0) {
    segments.push({
      label: otherLabel,
      count: otherCount,
      color: OTHER_COLOR,
      isOther: true,
    });
  }

  return segments;
}

function buildConicGradient(segments: DisplaySegment[], total: number): string {
  if (total <= 0) {
    return "conic-gradient(#e2e8f0 0deg 360deg)";
  }

  let current = 0;
  const stops: string[] = [];

  for (const segment of segments) {
    const start = (current / total) * 360;
    current += segment.count;
    const end = (current / total) * 360;
    stops.push(`${segment.color} ${start}deg ${end}deg`);
  }

  return `conic-gradient(${stops.join(", ")})`;
}

export function DashboardSourceDistributionDonut({
  sources,
}: {
  sources: CountByLabel[];
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const otherLabel = t("dashboard.sourceDistributionOther");
  const segments = useMemo(
    () => buildDisplaySegments(sources, otherLabel),
    [otherLabel, sources],
  );
  const total = useMemo(
    () => sources.reduce((sum, item) => sum + item.count, 0),
    [sources],
  );

  return (
    <Card className="min-w-0 overflow-hidden p-5">
      <h3 className="section-title mb-4">{t("dashboard.customersBySource")}</h3>

      {total === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm crm-text-secondary">
          {t("dashboard.stageDistributionEmpty")}
        </p>
      ) : (
        <>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
            <div
              className="relative h-36 w-36 shrink-0 rounded-full motion-safe:transition-[background] motion-safe:duration-500 sm:h-40 sm:w-40"
              style={{ background: buildConicGradient(segments, total) }}
              role="img"
              aria-label={t("dashboard.customersBySource")}
            >
              <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full surface-card text-center shadow-inner">
                <span className="text-2xl font-bold tabular-nums crm-text">
                  {total}
                </span>
                <span className="mt-0.5 text-xs crm-text-secondary">
                  {t("dashboard.sourceDistributionCenterLabel")}
                </span>
              </div>
            </div>

            <ul className="grid w-full min-w-0 grid-cols-1 gap-2 sm:flex-1">
              {segments.map((segment) => (
                <li
                  key={segment.label}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: segment.color }}
                      aria-hidden
                    />
                    <span className="truncate text-sm crm-text">{segment.label}</span>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums crm-text">
                    {segment.count}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {sources.length > TOP_SOURCE_COUNT ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="text-sm font-medium text-[var(--color-crm-primary)] hover:underline"
              >
                {expanded
                  ? t("common.collapse")
                  : t("dashboard.viewAllSourceDetails")}
              </button>

              {expanded ? (
                <ul className="mt-3 space-y-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  {sources.map((item) => (
                    <li
                      key={item.label}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 truncate crm-text">{item.label}</span>
                      <span className="shrink-0 font-semibold tabular-nums crm-text">
                        {item.count}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
