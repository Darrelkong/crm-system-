import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultDeviceName,
  summarizeUserAgent,
} from "@/lib/devices/ua-summary";

describe("ua-summary", () => {
  it("summarizes chrome on macOS", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    assert.equal(summarizeUserAgent(ua), "Chrome · macOS");
  });

  it("summarizes safari on iOS", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    assert.equal(summarizeUserAgent(ua), "Safari · iOS");
  });

  it("falls back for empty user agent", () => {
    assert.equal(summarizeUserAgent(null), "未知設備");
    assert.equal(defaultDeviceName(undefined), "未知設備");
  });
});
