import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import {
  buildHongKongDateSeriesEndingToday,
  comparePeriods,
  fillDailySeries,
  getHongKongDateYmdOffset,
  getHongKongSeriesUtcBounds,
  selectTrendWindow,
  sliceLastDays,
  slicePreviousPeriod,
  TREND_SERIES_LOOKBACK_DAYS,
} from "./dashboard-trends-period";

describe("dashboard trend period helpers", () => {
  const now = new Date("2026-08-06T04:00:00.000Z"); // HK noon

  it("builds 7 continuous HK dates ending today", () => {
    const dates = buildHongKongDateSeriesEndingToday(now, 7);
    assert.equal(dates.length, 7);
    assert.equal(dates[dates.length - 1], "2026-08-06");
    assert.equal(dates[0], "2026-07-31");
    for (let i = 1; i < dates.length; i += 1) {
      assert.ok(dates[i]! > dates[i - 1]!);
    }
  });

  it("fills missing days with zero", () => {
    const dates = ["2026-08-01", "2026-08-02", "2026-08-03"];
    const filled = fillDailySeries(
      dates,
      new Map([
        ["2026-08-01", 2],
        ["2026-08-03", 5],
      ]),
    );
    assert.deepEqual(filled, [
      { date: "2026-08-01", value: 2 },
      { date: "2026-08-02", value: 0 },
      { date: "2026-08-03", value: 5 },
    ]);
  });

  it("slices current and previous equal-length windows", () => {
    const series = Array.from({ length: 20 }, (_, i) => ({
      date: `d${i}`,
      value: i + 1,
    }));
    const current = sliceLastDays(series, 7);
    const previous = slicePreviousPeriod(series, 7);
    assert.equal(current.length, 7);
    assert.equal(previous.length, 7);
    assert.equal(current[0]?.date, "d13");
    assert.equal(previous[0]?.date, "d6");
  });

  it("compares periods without Infinity when previous is zero", () => {
    const flat = comparePeriods(
      [
        { date: "a", value: 0 },
        { date: "b", value: 0 },
      ],
      [
        { date: "c", value: 0 },
        { date: "d", value: 0 },
      ],
    );
    assert.equal(flat.direction, "flat");
    assert.equal(flat.changePercent, 0);

    const fresh = comparePeriods(
      [
        { date: "a", value: 3 },
        { date: "b", value: 1 },
      ],
      [
        { date: "c", value: 0 },
        { date: "d", value: 0 },
      ],
    );
    assert.equal(fresh.direction, "new_this_period");
    assert.equal(fresh.changePercent, null);
    assert.equal(fresh.currentTotal, 4);

    const down = comparePeriods(
      [{ date: "a", value: 2 }],
      [{ date: "b", value: 10 }],
    );
    assert.equal(down.direction, "down");
    assert.equal(down.change, -8);
    assert.equal(down.changePercent, -80);
  });

  it("selectTrendWindow defaults support 7/30/90 point counts", () => {
    const series = Array.from({ length: TREND_SERIES_LOOKBACK_DAYS }, (_, i) => ({
      date: `d${i}`,
      value: i % 5,
    }));
    assert.equal(selectTrendWindow(series, 7).current.length, 7);
    assert.equal(selectTrendWindow(series, 30).current.length, 30);
    assert.equal(selectTrendWindow(series, 90).current.length, 90);
    assert.equal(selectTrendWindow(series, 90).previous.length, 90);
  });

  it("HK midnight boundary shifts calendar day", () => {
    const before = new Date("2026-08-05T15:30:00.000Z");
    const after = new Date("2026-08-05T16:30:00.000Z");
    assert.equal(getHongKongDateYmdOffset(before, 0, HONG_KONG_TIMEZONE), "2026-08-05");
    assert.equal(getHongKongDateYmdOffset(after, 0, HONG_KONG_TIMEZONE), "2026-08-06");
  });

  it("series UTC bounds cover HK today end", () => {
    const bounds = getHongKongSeriesUtcBounds(now, 7, HONG_KONG_TIMEZONE);
    assert.equal(bounds.dates.length, 7);
    assert.ok(bounds.startIso < bounds.endExclusiveIso);
    assert.ok(bounds.endExclusiveIso > now.toISOString());
  });
});
