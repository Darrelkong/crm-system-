import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import {
  getBusinessCalendarDayDifference,
  getBusinessTodayRange,
} from "@/lib/reports/dates";
import {
  buildWorkViewWhere,
  parseReclamationRiskParam,
  parseWorkView,
} from "@/lib/customers/work-view-filter";
import type { User } from "../../../drizzle/schema/users";

const staffUser = {
  id: "11111111-1111-1111-1111-111111111102",
  role: "staff",
} as User;

const adminUser = {
  id: "11111111-1111-1111-1111-111111111101",
  role: "admin",
} as User;

describe("work view drilldown", () => {
  it("parses dueToday and overdue", () => {
    assert.equal(parseWorkView("dueToday"), "dueToday");
    assert.equal(parseWorkView("overdue"), "overdue");
    assert.equal(parseWorkView("team"), undefined);
    assert.equal(parseWorkView(undefined), undefined);
  });

  it("rejects team reclamation scope for staff", () => {
    assert.equal(parseReclamationRiskParam(staffUser, "mine"), "mine");
    assert.equal(parseReclamationRiskParam(staffUser, "team"), undefined);
    assert.equal(parseReclamationRiskParam(adminUser, "team"), "team");
  });

  it("builds distinct dueToday and overdue filters", () => {
    const now = new Date("2026-08-06T04:00:00.000Z");
    const { end: todayEnd } = getBusinessTodayRange(now, HONG_KONG_TIMEZONE);
    const tomorrowStart = new Date(
      new Date(todayEnd).getTime() + 1,
    ).toISOString();
    const dueToday = buildWorkViewWhere(
      staffUser,
      "dueToday",
      now.toISOString(),
      tomorrowStart,
    );
    const overdue = buildWorkViewWhere(
      staffUser,
      "overdue",
      now.toISOString(),
      tomorrowStart,
    );
    assert.ok(dueToday);
    assert.ok(overdue);
    assert.notEqual(dueToday!.queryChunks.length, 0);
    assert.notEqual(overdue!.queryChunks.length, 0);
  });
});

describe("Hong Kong business day boundaries", () => {
  const timezone = HONG_KONG_TIMEZONE;

  it("treats HK midnight as a new calendar day", () => {
    const hkLateNight = new Date("2026-08-05T15:30:00.000Z");
    const hkAfterMidnight = new Date("2026-08-05T16:30:00.000Z");
    const diff = getBusinessCalendarDayDifference(
      hkLateNight,
      hkAfterMidnight,
      timezone,
    );
    assert.equal(diff, 1);
  });

  it("keeps same HK calendar day across UTC date change", () => {
    const hkEvening = new Date("2026-08-05T14:00:00.000Z");
    const hkLate = new Date("2026-08-05T15:30:00.000Z");
    assert.equal(
      getBusinessCalendarDayDifference(hkEvening, hkLate, timezone),
      0,
    );
  });

  it("defines today range with HK end-of-day", () => {
    const now = new Date("2026-08-06T10:00:00.000Z");
    const { start, end } = getBusinessTodayRange(now, timezone);
    assert.ok(start < end);
    assert.ok(now.toISOString() >= start);
    assert.ok(now.toISOString() <= end);
  });
});
