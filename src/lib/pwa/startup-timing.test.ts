import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectNavigationTiming,
  createEmptyStartupTimingSnapshot,
  formatStartupTimingLines,
  parseStartupDebugFlag,
  parseStartupPreviewFlag,
  relativeMs,
  startupTimingContainsPii,
} from "./startup-timing";

describe("startup timing diagnostics", () => {
  it("parses startup debug and preview flags", () => {
    assert.equal(parseStartupDebugFlag("?startupDebug=1"), true);
    assert.equal(parseStartupDebugFlag("?startupPreview=1"), false);
    assert.equal(parseStartupPreviewFlag("?startupPreview=1"), true);
    assert.equal(parseStartupPreviewFlag(""), false);
  });

  it("collects navigation timing relative to origin", () => {
    const origin = 1000;
    const snapshot = collectNavigationTiming(
      {
        responseStart: 1420,
        responseEnd: 1890,
        domContentLoadedEventEnd: 2100,
        loadEventEnd: 2500,
      } as PerformanceNavigationTiming,
      origin,
    );
    assert.equal(snapshot.responseStartMs, 420);
    assert.equal(snapshot.responseEndMs, 890);
    assert.equal(snapshot.domContentLoadedMs, 1100);
    assert.equal(snapshot.windowLoadMs, 1500);
  });

  it("formats timing lines without PII", () => {
    const lines = formatStartupTimingLines({
      ...createEmptyStartupTimingSnapshot(),
      navigationStartMs: 0,
      responseStartMs: 420,
      bootShellVisibleMs: 12,
      reactHydratedMs: 1460,
      bootShellDismissedMs: 1510,
    });
    assert.match(lines.join("\n"), /Response start: 420ms/);
    assert.match(lines.join("\n"), /Boot splash removed: 1510ms/);
    assert.equal(startupTimingContainsPii(createEmptyStartupTimingSnapshot()), false);
  });

  it("computes relative milliseconds safely", () => {
    assert.equal(relativeMs(100, 250), 150);
    assert.equal(relativeMs(100, null), null);
  });
});
