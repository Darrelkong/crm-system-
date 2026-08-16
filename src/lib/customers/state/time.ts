/**
 * Time arithmetic for Customer State Engine V2.
 *
 * Authority: TASK 17-B-R1 §R, TASK 17-B-R2 §C/§D/§E.
 *
 * RULE R-0  — exactly one injected `now`; this module never calls `new Date()`
 *             to obtain the current instant.
 * RULE R-A  — First Contact uses elapsed hours (timezone-independent).
 * RULE R-B  — stage cadence and the Family B lookback use business-calendar
 *             day differences resolved in the effective settings timezone.
 * RULE R-D  — a timestamp failing parsing is treated as ABSENT, never as zero
 *             and never as a thrown error. No NaN may propagate.
 * RULE R-E  — V2 owns this helper. `reclamation/days.ts` MUST NOT be modified;
 *             the reclamation dimension keeps using it unchanged.
 */

import type { BusinessTimezone } from "@/lib/settings/effective";
import {
  getBusinessCalendarDayDifference,
  getTimezoneOffsetMs,
} from "@/lib/reports/dates";
import { HONG_KONG_TIMEZONE, parseUtcDate } from "@/lib/timezone";

export const DEFAULT_STATE_TIMEZONE: BusinessTimezone = HONG_KONG_TIMEZONE;

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * CRM timestamps are ISO calendar values with either `T` or SQLite's space
 * separator. The shared `parseUtcDate` contract also permits an absent offset
 * and interprets that form as UTC.
 *
 * Capture the calendar/time fields before delegating because JavaScript's
 * parser normalizes some impossible dates (for example February 30) instead of
 * rejecting them. This remains the one canonical validator for every V2
 * timestamp and does not change the frozen shared/reclamation parser.
 */
const STATE_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:(?:T| )(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:(Z)|([+-])(\d{2}):?(\d{2}))?)?$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const monthLengths = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ] as const;
  return monthLengths[month - 1] ?? 0;
}

function hasValidStateInstantParts(value: string): boolean {
  const match = STATE_INSTANT_PATTERN.exec(value);
  if (!match) return false;

  const [
    ,
    rawYear,
    rawMonth,
    rawDay,
    rawHour,
    rawMinute,
    rawSecond,
    rawFraction,
    utcDesignator,
    offsetSign,
    rawOffsetHour,
    rawOffsetMinute,
  ] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;

  if (rawHour !== undefined) {
    const hour = Number(rawHour);
    const minute = Number(rawMinute);
    const second = rawSecond === undefined ? 0 : Number(rawSecond);
    if (hour > 23 || minute > 59 || second > 59) return false;
  }

  if (offsetSign !== undefined) {
    if (Number(rawOffsetHour) > 23 || Number(rawOffsetMinute) > 59) return false;
  }

  // Match the existing `parseUtcDate` naive-UTC contract exactly: offset-less
  // fractional seconds are supported only in the stored three-digit form.
  if (
    utcDesignator === undefined &&
    offsetSign === undefined &&
    rawFraction !== undefined &&
    rawFraction.length !== 3
  ) {
    return false;
  }

  return true;
}

/**
 * RULE R-D / R2 §C — the single canonical parse used for every V2 timestamp.
 * Returns `null` for absent, blank, and malformed values alike so that a
 * malformed value has exactly the same state semantics as an absent one.
 */
export function parseStateInstant(
  value: string | null | undefined,
): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !hasValidStateInstantParts(trimmed)) return null;
  return parseUtcDate(trimmed);
}

/** RULE R-A — fractional elapsed hours from `anchor` to `now`. */
export function getElapsedHours(anchor: Date, now: Date): number {
  return (now.getTime() - anchor.getTime()) / MS_PER_HOUR;
}

/** RULE R-B — integer business-calendar day difference (`to` minus `from`). */
export function getStateCalendarDayDifference(
  from: Date,
  to: Date,
  timezone: BusinessTimezone,
): number {
  return getBusinessCalendarDayDifference(from, to, timezone);
}

type LocalDateParts = { year: number; month: number; day: number };

function getLocalDateParts(
  instant: Date,
  timezone: BusinessTimezone,
): LocalDateParts {
  const shifted = new Date(instant.getTime() + getTimezoneOffsetMs(timezone));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Instant of 00:00 local time on the given local calendar date. */
function getLocalDateStartInstant(
  parts: LocalDateParts,
  timezone: BusinessTimezone,
): Date {
  return new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day) -
      getTimezoneOffsetMs(timezone),
  );
}

/**
 * R2 §D — `stageDueAt` is the FIRST instant at which
 * `businessCalendarDayDifference(lastValidInteraction, instant) > Target`,
 * i.e. 00:00 local on `localDate(lastValidInteraction) + Target + 1 days`.
 */
export function computeStageDueAt(
  lastValidInteraction: Date,
  targetDays: number,
  timezone: BusinessTimezone,
): Date {
  const local = getLocalDateParts(lastValidInteraction, timezone);
  return getLocalDateStartInstant(
    { ...local, day: local.day + targetDays + 1 },
    timezone,
  );
}

/** R2 §D — `effectiveDueAt = MIN(stageDueAt, parseable nextFollowUpAt)`. */
export function computeEffectiveDueAt(
  stageDueAt: Date,
  parsedNextFollowUpAt: Date | null,
): Date {
  if (
    parsedNextFollowUpAt !== null &&
    parsedNextFollowUpAt.getTime() < stageDueAt.getTime()
  ) {
    return parsedNextFollowUpAt;
  }
  return stageDueAt;
}
