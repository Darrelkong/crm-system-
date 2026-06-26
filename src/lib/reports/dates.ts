import type { BusinessTimezone } from "@/lib/settings/effective";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";

/** UTC+8 offset for Asia/Hong_Kong (no DST). */
export const BUSINESS_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

export type ReportsTimezone = BusinessTimezone | typeof HONG_KONG_TIMEZONE;

export const BUSINESS_TIMEZONE = HONG_KONG_TIMEZONE;

export function getTimezoneOffsetMs(timezone: ReportsTimezone): number {
  return timezone === "UTC" ? 0 : BUSINESS_UTC_OFFSET_MS;
}

function getDatePartsForTimezone(
  now: Date,
  timezone: ReportsTimezone,
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
  timezone: ReportsTimezone,
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
  timezone: ReportsTimezone = HONG_KONG_TIMEZONE,
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
  timezone: ReportsTimezone = HONG_KONG_TIMEZONE,
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
  timezone: ReportsTimezone = HONG_KONG_TIMEZONE,
): string {
  const { year, month, day } = getDatePartsForTimezone(now, timezone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Calendar week (Monday–Sunday) in the configured timezone: Monday 00:00 inclusive, next Monday exclusive. */
export function getBusinessWeekRange(
  now: Date = new Date(),
  timezone: ReportsTimezone = HONG_KONG_TIMEZONE,
): { start: string; endExclusive: string } {
  const { year, month, day } = getDatePartsForTimezone(now, timezone);
  const todayStartIso = localWallClockToUtcIso(
    year,
    month,
    day,
    timezone,
    0,
    0,
    0,
    0,
  );
  const todayStartMs = new Date(todayStartIso).getTime();
  const offset = getTimezoneOffsetMs(timezone);
  const noonUtcMs = Date.UTC(year, month - 1, day, 12, 0, 0, 0) - offset;
  const jsDay = new Date(noonUtcMs).getUTCDay();
  const daysFromMonday = jsDay === 0 ? 6 : jsDay - 1;
  const weekStartMs = todayStartMs - daysFromMonday * 24 * 60 * 60 * 1000;
  return {
    start: new Date(weekStartMs).toISOString(),
    endExclusive: new Date(weekStartMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
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
