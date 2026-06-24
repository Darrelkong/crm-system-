import type { BusinessTimezone } from "@/lib/settings/effective";

/** UTC+8 offset for Asia/Shanghai (no DST). */
export const BUSINESS_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

export const BUSINESS_TIMEZONE = "Asia/Shanghai" as const;

export function getTimezoneOffsetMs(timezone: BusinessTimezone): number {
  return timezone === "UTC" ? 0 : BUSINESS_UTC_OFFSET_MS;
}

function getDatePartsForTimezone(
  now: Date,
  timezone: BusinessTimezone,
): { year: number; month: number; day: number } {
  const offset = getTimezoneOffsetMs(timezone);
  const shifted = new Date(now.getTime() + offset);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function localWallClockToUtcIso(
  year: number,
  month: number,
  day: number,
  timezone: BusinessTimezone,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): string {
  const offset = getTimezoneOffsetMs(timezone);
  const utcMs =
    Date.UTC(year, month - 1, day, hour, minute, second, ms) - offset;
  return new Date(utcMs).toISOString();
}

/** Calendar day 00:00:00 – 23:59:59.999 in the configured timezone, as UTC ISO bounds. */
export function getBusinessTodayRange(
  now: Date = new Date(),
  timezone: BusinessTimezone = "Asia/Shanghai",
): { start: string; end: string } {
  const { year, month, day } = getDatePartsForTimezone(now, timezone);
  return {
    start: localWallClockToUtcIso(year, month, day, timezone, 0, 0, 0, 0),
    end: localWallClockToUtcIso(year, month, day, timezone, 23, 59, 59, 999),
  };
}

/** Calendar month in the configured timezone: month start inclusive, next month start exclusive. */
export function getBusinessMonthRange(
  now: Date = new Date(),
  timezone: BusinessTimezone = "Asia/Shanghai",
): { start: string; endExclusive: string } {
  const { year, month } = getDatePartsForTimezone(now, timezone);
  const start = localWallClockToUtcIso(year, month, 1, timezone, 0, 0, 0, 0);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endExclusive = localWallClockToUtcIso(
    nextYear,
    nextMonth,
    1,
    timezone,
    0,
    0,
    0,
    0,
  );
  return { start, endExclusive };
}

/** Calendar date YYYY-MM-DD in the configured timezone. */
export function getBusinessDateYmd(
  now: Date = new Date(),
  timezone: BusinessTimezone = "Asia/Shanghai",
): string {
  const { year, month, day } = getDatePartsForTimezone(now, timezone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
