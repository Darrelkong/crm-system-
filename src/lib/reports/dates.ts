/**
 * Business reporting timezone: Asia/Shanghai (UTC+8, no DST).
 * Database timestamps remain UTC; boundaries are converted for queries.
 */
export const BUSINESS_TIMEZONE = "Asia/Shanghai" as const;
export const BUSINESS_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

function getBusinessDateParts(now: Date): {
  year: number;
  month: number;
  day: number;
} {
  const shifted = new Date(now.getTime() + BUSINESS_UTC_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Convert a business-local (UTC+8) wall-clock time to a UTC ISO string. */
function businessLocalToUtcIso(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): string {
  const utcMs =
    Date.UTC(year, month - 1, day, hour, minute, second, ms) -
    BUSINESS_UTC_OFFSET_MS;
  return new Date(utcMs).toISOString();
}

/** UTC+8 calendar day 00:00:00 – 23:59:59.999, expressed as UTC ISO bounds. */
export function getBusinessTodayRange(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const { year, month, day } = getBusinessDateParts(now);
  return {
    start: businessLocalToUtcIso(year, month, day, 0, 0, 0, 0),
    end: businessLocalToUtcIso(year, month, day, 23, 59, 59, 999),
  };
}

/**
 * UTC+8 calendar month: from 1st 00:00:00 inclusive to next month 1st 00:00:00 exclusive.
 */
export function getBusinessMonthRange(now: Date = new Date()): {
  start: string;
  endExclusive: string;
} {
  const { year, month } = getBusinessDateParts(now);
  const start = businessLocalToUtcIso(year, month, 1, 0, 0, 0, 0);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endExclusive = businessLocalToUtcIso(
    nextYear,
    nextMonth,
    1,
    0,
    0,
    0,
    0,
  );
  return { start, endExclusive };
}

/** Rolling 7×24h window ending at `now` (not a calendar week). */
export function getRollingSevenDaysAgoIso(now: Date = new Date()): string {
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

/** @deprecated Use getBusinessTodayRange */
export const getTodayRangeUtc = getBusinessTodayRange;

/** @deprecated Use getBusinessMonthRange().start */
export function getMonthStartIso(now: Date = new Date()): string {
  return getBusinessMonthRange(now).start;
}

/** @deprecated Use getRollingSevenDaysAgoIso */
export const getSevenDaysAgoIso = getRollingSevenDaysAgoIso;
