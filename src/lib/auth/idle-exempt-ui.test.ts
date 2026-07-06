import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addClickTimestamp,
  IDLE_EXEMPT_TRIGGER_COUNT,
  IDLE_EXEMPT_TRIGGER_WINDOW_MS,
  isIdleExemptActive,
  parseActivateResponse,
  shouldTriggerIdleExempt,
} from "@/lib/auth/idle-exempt-ui";

// ---------------------------------------------------------------------------
// Click detection
// ---------------------------------------------------------------------------

describe("addClickTimestamp", () => {
  it("adds a new timestamp to an empty array", () => {
    const result = addClickTimestamp([], 1000);
    assert.deepEqual(result, [1000]);
  });

  it("retains timestamps within the trigger window", () => {
    const now = 5000;
    const timestamps = [3000, 4000]; // both within 3s of now=5000
    const result = addClickTimestamp(timestamps, now);
    assert.deepEqual(result, [3000, 4000, 5000]);
  });

  it("drops timestamps older than IDLE_EXEMPT_TRIGGER_WINDOW_MS", () => {
    const now = 10_000;
    const old = now - IDLE_EXEMPT_TRIGGER_WINDOW_MS - 1; // just outside window
    const recent = now - 1000;
    const result = addClickTimestamp([old, recent], now);
    assert.deepEqual(result, [recent, now]);
  });

  it("does not mutate the input array", () => {
    const original = [1000, 2000];
    const frozen = Object.freeze(original);
    addClickTimestamp(frozen, 3000);
    assert.deepEqual(original, [1000, 2000]);
  });
});

describe("shouldTriggerIdleExempt", () => {
  it(`triggers when timestamps.length === ${IDLE_EXEMPT_TRIGGER_COUNT}`, () => {
    const ts = Array.from({ length: IDLE_EXEMPT_TRIGGER_COUNT }, (_, i) => i);
    assert.equal(shouldTriggerIdleExempt(ts), true);
  });

  it("does not trigger with fewer than required clicks", () => {
    const ts = Array.from({ length: IDLE_EXEMPT_TRIGGER_COUNT - 1 }, (_, i) => i);
    assert.equal(shouldTriggerIdleExempt(ts), false);
  });

  it("does not trigger with an empty array", () => {
    assert.equal(shouldTriggerIdleExempt([]), false);
  });

  it("triggers with more than required clicks (edge case)", () => {
    const ts = Array.from({ length: IDLE_EXEMPT_TRIGGER_COUNT + 2 }, (_, i) => i);
    assert.equal(shouldTriggerIdleExempt(ts), true);
  });
});

describe("3-second window integration", () => {
  it("7 rapid clicks within window trigger after 7th click", () => {
    const base = 10_000;
    let ts: number[] = [];
    for (let i = 0; i < IDLE_EXEMPT_TRIGGER_COUNT; i++) {
      ts = addClickTimestamp(ts, base + i * 100); // 100ms apart
    }
    assert.equal(shouldTriggerIdleExempt(ts), true);
  });

  it("clicks spread over more than 3 seconds do NOT trigger", () => {
    const base = 0;
    let ts: number[] = [];
    // 7 clicks, each 500ms apart = 3000ms total from first to last
    // BUT the window is 3000ms from *now* (the last click), not from first
    // First click at 0, last at 3000 → first is exactly at the boundary
    // let's make the first one just barely outside (3001ms before last)
    for (let i = 0; i < IDLE_EXEMPT_TRIGGER_COUNT; i++) {
      ts = addClickTimestamp(ts, base + i * 501); // 501ms apart
    }
    // After 7th addClickTimestamp at base+3006:
    // First click at 0 is 3006ms before now=3006 → outside 3000ms window → dropped
    assert.equal(shouldTriggerIdleExempt(ts), false);
  });

  it("only clicks within the recent window count towards trigger", () => {
    // 3 old clicks, then 7 new rapid clicks
    const oldBase = 0;
    const newBase = 50_000;
    let ts: number[] = [];
    // Add 3 old clicks
    for (let i = 0; i < 3; i++) {
      ts = addClickTimestamp(ts, oldBase + i * 100);
    }
    // Add 7 new clicks
    for (let i = 0; i < IDLE_EXEMPT_TRIGGER_COUNT; i++) {
      ts = addClickTimestamp(ts, newBase + i * 100);
    }
    assert.equal(shouldTriggerIdleExempt(ts), true);
  });
});

// ---------------------------------------------------------------------------
// Client idle guard
// ---------------------------------------------------------------------------

describe("isIdleExemptActive", () => {
  it("returns true when exemptUntil is in the future", () => {
    const now = 1_000_000;
    assert.equal(isIdleExemptActive(now + 1000, now), true);
  });

  it("returns false when exemptUntil is in the past", () => {
    const now = 1_000_000;
    assert.equal(isIdleExemptActive(now - 1, now), false);
  });

  it("returns false when exemptUntil equals now (boundary)", () => {
    const now = 1_000_000;
    assert.equal(isIdleExemptActive(now, now), false);
  });

  it("returns false when exemptUntil is null", () => {
    assert.equal(isIdleExemptActive(null, Date.now()), false);
  });
});

// ---------------------------------------------------------------------------
// API response parsing
// ---------------------------------------------------------------------------

describe("parseActivateResponse", () => {
  it("parses a 200 OK response with valid exemptUntil", () => {
    const future = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
    const result = parseActivateResponse(200, { ok: true, exemptUntil: future });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.exemptUntil > Date.now());
    }
  });

  it("returns generic error for malformed 200 response", () => {
    const result = parseActivateResponse(200, { ok: false });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.disabled, false);
      assert.ok(result.message.length > 0);
    }
  });

  it("returns disabled=true for 403 (feature disabled)", () => {
    const result = parseActivateResponse(403, { error: "該操作已被限制，請聯絡管理員。" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.disabled, true);
      assert.equal(result.message, "該操作已被限制，請聯絡管理員。");
    }
  });

  it("returns lockout message for 429", () => {
    const result = parseActivateResponse(429, { error: "too many" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.disabled, false);
      assert.equal(result.message, "嘗試次數過多，請稍後再試。");
    }
  });

  it("returns generic error for 401 — does not expose internal details", () => {
    const result = parseActivateResponse(401, { error: "internal server session state" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.disabled, false);
      assert.equal(result.message, "驗證失敗，請確認後再試。");
    }
  });

  it("returns generic error for unexpected status codes", () => {
    const result = parseActivateResponse(500, { error: "internal" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.disabled, false);
    }
  });
});
