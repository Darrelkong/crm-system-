/**
 * Hong Kong calendar rolling ranges for AI Effect Stats.
 * from inclusive, to exclusive; never use browser timezone.
 */

import {
  BUSINESS_TIMEZONE,
  getTimezoneOffsetMs,
  type ReportsTimezone,
} from "@/lib/reports/dates";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";

export const AI_EFFECT_STATS_ALLOWED_RANGES = [7, 30, 90] as const;
export type AiEffectStatsRangeDays =
  (typeof AI_EFFECT_STATS_ALLOWED_RANGES)[number];
export const AI_EFFECT_STATS_DEFAULT_RANGE_DAYS: AiEffectStatsRangeDays = 30;
export const AI_EFFECT_STATS_TIMEZONE = HONG_KONG_TIMEZONE;

export type AiEffectStatsDateRange = {
  days: AiEffectStatsRangeDays;
  from: string;
  to: string;
  timezone: typeof HONG_KONG_TIMEZONE;
};

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

/** Add calendar days to a Y-M-D triple (Gregorian). */
export function addCalendarDays(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const utc = Date.UTC(year, month - 1, day) + deltaDays * 24 * 60 * 60 * 1000;
  const d = new Date(utc);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

export function isAllowedAiEffectStatsRange(
  value: unknown,
): value is AiEffectStatsRangeDays {
  return (
    typeof value === "number" &&
    (AI_EFFECT_STATS_ALLOWED_RANGES as readonly number[]).includes(value)
  );
}

/**
 * Rolling N Hong Kong calendar days ending at the start of tomorrow (exclusive to).
 * Includes today as the last day of the window.
 */
export function getAiEffectStatsDateRange(
  days: AiEffectStatsRangeDays,
  now: Date = new Date(),
): AiEffectStatsDateRange {
  const timezone = BUSINESS_TIMEZONE;
  const today = getDatePartsForTimezone(now, timezone);
  const tomorrow = addCalendarDays(today.year, today.month, today.day, 1);
  const fromDay = addCalendarDays(
    today.year,
    today.month,
    today.day,
    -(days - 1),
  );

  return {
    days,
    from: localWallClockToUtcIso(
      fromDay.year,
      fromDay.month,
      fromDay.day,
      timezone,
      0,
      0,
      0,
      0,
    ),
    to: localWallClockToUtcIso(
      tomorrow.year,
      tomorrow.month,
      tomorrow.day,
      timezone,
      0,
      0,
      0,
      0,
    ),
    timezone: AI_EFFECT_STATS_TIMEZONE,
  };
}
