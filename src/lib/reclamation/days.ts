import type { Customer } from "../../../drizzle/schema/customers";
import {
  getBusinessCalendarDayDifference,
  getBusinessDateYmd,
} from "@/lib/reports/dates";
import { HONG_KONG_TIMEZONE, parseUtcDate } from "@/lib/timezone";
import { getReclamationCycleStartedAt } from "./cycle";

/** Anchor for reclamation idle-day count. */
export function getReclamationAnchorAt(customer: Customer): string {
  return getReclamationCycleStartedAt(customer);
}

/**
 * Idle whole business days since the cycle anchor in Asia/Hong_Kong.
 * Day 0 = anchor calendar date; day 7 = 7 full HK calendar days later.
 */
export function getDaysWithoutValidFollowUp(
  customer: Customer,
  now: Date,
): number {
  const anchor = parseUtcDate(getReclamationAnchorAt(customer));
  if (!anchor) {
    return 0;
  }
  return getBusinessCalendarDayDifference(anchor, now, HONG_KONG_TIMEZONE);
}

/** HK calendar date YYYY-MM-DD for warning log dedup metadata. */
export function getWarningDateKey(now: Date): string {
  return getBusinessDateYmd(now, HONG_KONG_TIMEZONE);
}
