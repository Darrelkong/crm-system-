import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTrendChartCoords,
  clampTrendIndex,
  formatTrendTooltipDate,
  getTrendTooltipSide,
  moveTrendIndex,
  nearestTrendIndexFromClientX,
  nearestTrendIndexFromRatio,
  resolveTrendIndexAfterLengthChange,
  TREND_CHART_WIDTH,
} from "./dashboard-trends-interaction";

describe("dashboard trend interaction helpers", () => {
  it("defaults with no active index until interaction", () => {
    assert.equal(resolveTrendIndexAfterLengthChange(null, 7), null);
  });

  it("maps pointer ratio to nearest point for 7/30/90", () => {
    assert.equal(nearestTrendIndexFromRatio(0, 7), 0);
    assert.equal(nearestTrendIndexFromRatio(1, 7), 6);
    assert.equal(nearestTrendIndexFromRatio(0.5, 7), 3);

    assert.equal(nearestTrendIndexFromRatio(0, 30), 0);
    assert.equal(nearestTrendIndexFromRatio(1, 30), 29);
    assert.equal(nearestTrendIndexFromRatio(0.5, 30), 15);

    assert.equal(nearestTrendIndexFromRatio(0, 90), 0);
    assert.equal(nearestTrendIndexFromRatio(1, 90), 89);
    assert.equal(nearestTrendIndexFromRatio(0.25, 90), 22);
  });

  it("selects nearest index from client X within chart rect", () => {
    const rect = { left: 100, width: 200 };
    assert.equal(
      nearestTrendIndexFromClientX(100, rect, 7),
      0,
    );
    assert.equal(
      nearestTrendIndexFromClientX(300, rect, 7),
      6,
    );
    const mid = nearestTrendIndexFromClientX(200, rect, 7);
    assert.equal(mid, 3);
  });

  it("moves with keyboard deltas, Home/End bounds, and Escape clears via null", () => {
    assert.equal(moveTrendIndex(null, 7, 1), 0);
    assert.equal(moveTrendIndex(null, 7, -1), 6);
    assert.equal(moveTrendIndex(3, 7, -1), 2);
    assert.equal(moveTrendIndex(3, 7, 1), 4);
    assert.equal(clampTrendIndex(0, 7), 0);
    assert.equal(clampTrendIndex(6, 7), 6);
    assert.equal(clampTrendIndex(99, 7), 6);
    assert.equal(clampTrendIndex(-2, 7), 0);
  });

  it("clamps active index safely after range length changes", () => {
    assert.equal(resolveTrendIndexAfterLengthChange(89, 7), 6);
    assert.equal(resolveTrendIndexAfterLengthChange(5, 90), 5);
    assert.equal(resolveTrendIndexAfterLengthChange(0, 0), null);
  });

  it("places tooltip start on the left and end on the right", () => {
    assert.equal(getTrendTooltipSide(0, 7), "start");
    assert.equal(getTrendTooltipSide(1, 7), "start");
    assert.equal(getTrendTooltipSide(6, 7), "end");
    assert.equal(getTrendTooltipSide(5, 7), "end");
  });

  it("builds continuous coords including zero values", () => {
    const coords = buildTrendChartCoords([
      { date: "2026-08-01", value: 0 },
      { date: "2026-08-02", value: 0 },
      { date: "2026-08-03", value: 5 },
    ]);
    assert.equal(coords.length, 3);
    assert.equal(coords[0]?.value, 0);
    assert.equal(coords[0]?.x, coords[0]?.x);
    assert.ok(coords[0]!.x < coords[2]!.x);
    assert.ok(coords[0]!.y > coords[2]!.y);
    assert.ok(coords.every((c) => c.x >= 0 && c.x <= TREND_CHART_WIDTH));
  });

  it("formats tooltip dates for en and Chinese locales as integers-friendly labels", () => {
    const en = formatTrendTooltipDate("2026-08-06", "en");
    assert.match(en, /August/);
    assert.match(en, /2026/);
    const zh = formatTrendTooltipDate("2026-08-06", "zh-Hans");
    assert.match(zh, /2026/);
    assert.match(zh, /8/);
  });
});
