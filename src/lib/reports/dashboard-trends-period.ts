import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import {
  getBusinessCalendarDayIndex,
  getBusinessDateYmd,
  getBusinessTodayRange,
  type ReportsTimezone,
} from "./dates";

export const TREND_RANGE_DAYS = [7, 30, 90] as const;
export type TrendRangeDays = (typeof TREND_RANGE_DAYS)[number];

/** Days of daily series to fetch so 90-day view can compare to the previous 90 days. */
export const TREND_SERIES_LOOKBACK_DAYS = 180;

export type DailyPoint = {
  date: string;
  value: number;
};

export type PeriodComparison = {
  currentTotal: number;
  previousTotal: number;
  change: number;
  changePercent: number | null;
  /** new_this_period | flat | up | down */
  direction: "new_this_period" | "flat" | "up" | "down";
};

/** HK calendar YMD for `offsetDays` relative to `now` (0 = today). */
export function getHongKongDateYmdOffset(
  now: Date,
  offsetDays: number,
  timezone: ReportsTimezone = HONG_KONG_TIMEZONE,
): string {
  const todayIndex = getBusinessCalendarDayIndex(now, timezone);
  const targetIndex = todayIndex + offsetDays;
  const utcMs = targetIndex * 86_400_000;
  const approx = new Date(utcMs + 12 * 60 * 60 * 1000);
  return getBusinessDateYmd(approx, timezone);
}

/**
 * Continuous HK calendar dates from oldest → newest.
 * `dayCount` days ending today inclusive.
 */
export function buildHongKongDateSeriesEndingToday(
  now: Date,
  dayCount: number,
  timezone: ReportsTimezone = HONG_KONG_TIMEZONE,
): string[] {
  const dates: string[] = [];
  for (let offset = -(dayCount - 1); offset <= 0; offset += 1) {
    dates.push(getHongKongDateYmdOffset(now, offset, timezone));
  }
  return dates;
}

/** Inclusive UTC ISO bounds covering `dates[0]` 00:00 through `dates[last]` 23:59:59.999 HKT. */
export function getHongKongSeriesUtcBounds(
  now: Date,
  dayCount: number,
  timezone: ReportsTimezone = HONG_KONG_TIMEZONE,
): { startIso: string; endExclusiveIso: string; dates: string[] } {
  const dates = buildHongKongDateSeriesEndingToday(now, dayCount, timezone);
  const oldest = dates[0]!;
  const [y, m, d] = oldest.split("-").map(Number);
  const offsetMs = timezone === "UTC" ? 0 : 8 * 60 * 60 * 1000;
  const startIso = new Date(
    Date.UTC(y!, m! - 1, d!, 0, 0, 0, 0) - offsetMs,
  ).toISOString();
  const { end: todayEnd } = getBusinessTodayRange(now, timezone);
  const endExclusiveIso = new Date(
    new Date(todayEnd).getTime() + 1,
  ).toISOString();
  return { startIso, endExclusiveIso, dates };
}

export function fillDailySeries(
  dates: string[],
  countsByDate: Map<string, number>,
): DailyPoint[] {
  return dates.map((date) => ({
    date,
    value: countsByDate.get(date) ?? 0,
  }));
}

export function sliceLastDays(
  series: DailyPoint[],
  days: TrendRangeDays,
): DailyPoint[] {
  if (series.length <= days) return series;
  return series.slice(series.length - days);
}

export function slicePreviousPeriod(
  series: DailyPoint[],
  days: TrendRangeDays,
): DailyPoint[] {
  if (series.length < days * 2) {
    const start = Math.max(0, series.length - days * 2);
    const end = Math.max(0, series.length - days);
    return series.slice(start, end);
  }
  return series.slice(series.length - days * 2, series.length - days);
}

export function sumSeries(points: DailyPoint[]): number {
  return points.reduce((sum, point) => sum + point.value, 0);
}

export function comparePeriods(
  current: DailyPoint[],
  previous: DailyPoint[],
): PeriodComparison {
  const currentTotal = sumSeries(current);
  const previousTotal = sumSeries(previous);
  const change = currentTotal - previousTotal;

  if (previousTotal === 0 && currentTotal === 0) {
    return {
      currentTotal,
      previousTotal,
      change: 0,
      changePercent: 0,
      direction: "flat",
    };
  }
  if (previousTotal === 0 && currentTotal > 0) {
    return {
      currentTotal,
      previousTotal,
      change,
      changePercent: null,
      direction: "new_this_period",
    };
  }
  const changePercent = Math.round((change / previousTotal) * 1000) / 10;
  return {
    currentTotal,
    previousTotal,
    change,
    changePercent,
    direction: change === 0 ? "flat" : change > 0 ? "up" : "down",
  };
}

export function selectTrendWindow(
  fullSeries: DailyPoint[],
  days: TrendRangeDays,
): {
  current: DailyPoint[];
  previous: DailyPoint[];
  comparison: PeriodComparison;
} {
  const current = sliceLastDays(fullSeries, days);
  const previous = slicePreviousPeriod(fullSeries, days);
  return {
    current,
    previous,
    comparison: comparePeriods(current, previous),
  };
}
