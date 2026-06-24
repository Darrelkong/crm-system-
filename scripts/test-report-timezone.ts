/**
 * Quick sanity check for UTC+8 report date boundaries.
 * Run: npx tsx scripts/test-report-timezone.ts
 */
import {
  BUSINESS_TIMEZONE,
  getBusinessMonthRange,
  getBusinessTodayRange,
} from "../src/lib/reports/dates";

// UTC 2026-06-24 18:00 = UTC+8 2026-06-25 02:00 (business "today" is June 25)
const edgeUtc = new Date("2026-06-24T18:00:00.000Z");

const today = getBusinessTodayRange(edgeUtc);
const month = getBusinessMonthRange(edgeUtc);

console.log("Business timezone:", BUSINESS_TIMEZONE);
console.log("\nEdge instant (UTC):", edgeUtc.toISOString());
console.log("Business today range (UTC ISO):", today);
console.log("Expected today start:", "2026-06-24T16:00:00.000Z"); // UTC+8 Jun 25 00:00
console.log("Expected today end:  ", "2026-06-25T15:59:59.999Z");

console.log("\nBusiness month range (UTC ISO):", month);
console.log("Expected month start:", "2026-05-31T16:00:00.000Z");
console.log("Expected month end:  ", "2026-06-30T16:00:00.000Z");

const dueInBusinessToday = "2026-06-24T20:00:00.000Z"; // Jun 25 04:00 UTC+8
const inToday =
  dueInBusinessToday >= today.start && dueInBusinessToday <= today.end;
console.log("\nDue", dueInBusinessToday, "counts as business today?", inToday);

const createdInBusinessMonth = "2026-05-31T20:00:00.000Z"; // Jun 1 04:00 UTC+8
const inMonth =
  createdInBusinessMonth >= month.start &&
  createdInBusinessMonth < month.endExclusive;
console.log(
  "Created",
  createdInBusinessMonth,
  "counts as business this month?",
  inMonth,
);
