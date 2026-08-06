import type { DailyPoint } from "./dashboard-trends-period";

export const TREND_CHART_WIDTH = 640;
export const TREND_CHART_HEIGHT = 220;
export const TREND_CHART_PAD_X = 12;
export const TREND_CHART_PAD_Y = 16;

export type ChartCoord = DailyPoint & { x: number; y: number; index: number };

export function clampTrendIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, index));
}

/** Map a 0–1 horizontal ratio within the plot area to the nearest point index. */
export function nearestTrendIndexFromRatio(
  ratio: number,
  length: number,
): number {
  if (length <= 0) return 0;
  if (length === 1) return 0;
  const clamped = Math.max(0, Math.min(1, ratio));
  return clampTrendIndex(Math.round(clamped * (length - 1)), length);
}

/**
 * Resolve nearest point from pointer X relative to the chart element.
 * Uses the padded plot area so edges align with first/last points.
 */
export function nearestTrendIndexFromClientX(
  clientX: number,
  rect: { left: number; width: number },
  length: number,
  padX: number = TREND_CHART_PAD_X,
  chartWidth: number = TREND_CHART_WIDTH,
): number {
  if (length <= 0 || rect.width <= 0) return 0;
  const localX = ((clientX - rect.left) / rect.width) * chartWidth;
  const plotW = chartWidth - padX * 2;
  if (plotW <= 0) return 0;
  const ratio = (localX - padX) / plotW;
  return nearestTrendIndexFromRatio(ratio, length);
}

export function moveTrendIndex(
  current: number | null,
  length: number,
  delta: number,
): number | null {
  if (length <= 0) return null;
  if (current == null) {
    return delta < 0 ? length - 1 : 0;
  }
  return clampTrendIndex(current + delta, length);
}

export function resolveTrendIndexAfterLengthChange(
  previous: number | null,
  nextLength: number,
): number | null {
  if (previous == null || nextLength <= 0) return null;
  return clampTrendIndex(previous, nextLength);
}

/** Prefer expanding tooltip away from the near edge. */
export function getTrendTooltipSide(
  index: number,
  length: number,
): "start" | "end" {
  if (length <= 1) return "start";
  const ratio = index / (length - 1);
  return ratio > 0.55 ? "end" : "start";
}

export function buildTrendChartCoords(
  points: DailyPoint[],
  options?: {
    width?: number;
    height?: number;
    padX?: number;
    padY?: number;
  },
): ChartCoord[] {
  const width = options?.width ?? TREND_CHART_WIDTH;
  const height = options?.height ?? TREND_CHART_HEIGHT;
  const padX = options?.padX ?? TREND_CHART_PAD_X;
  const padY = options?.padY ?? TREND_CHART_PAD_Y;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;
  const maxValue = Math.max(...points.map((p) => p.value), 1);

  return points.map((point, index) => {
    const x =
      points.length === 1
        ? padX + chartW / 2
        : padX + (index / (points.length - 1)) * chartW;
    const y = padY + chartH - (point.value / maxValue) * chartH;
    return { ...point, x, y, index };
  });
}

/** Long localized calendar date for tooltips (HK calendar day of YMD). */
export function formatTrendTooltipDate(ymd: string, locale: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "Asia/Hong_Kong",
    }).format(new Date(Date.UTC(y, m - 1, d, 4, 0, 0)));
  } catch {
    return ymd;
  }
}

export function formatTrendAxisDate(ymd: string, locale: string): string {
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
