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
 * RULE R-D / R2 §C — the single canonical parse used for every V2 timestamp.
 * Returns `null` for absent, blank, and malformed values alike so that a
 * malformed value has exactly the same state semantics as an absent one.
 */
export function parseStateInstant(
  value: string | null | undefined,
): Date | null {
  if (typeof value !== "string") return null;
  return parseUtcDate(value);
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
