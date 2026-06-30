import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_REFRESH_COOLDOWN_MS,
  isAiRefreshOnCooldown,
  msUntilAiRefreshAllowed,
} from "./cooldown";

describe("AI insight refresh cooldown", () => {
  const nowMs = Date.parse("2026-06-30T12:00:00.000Z");

  it("allows refresh when no existing insight", () => {
    assert.equal(isAiRefreshOnCooldown(null, nowMs), false);
    assert.equal(msUntilAiRefreshAllowed(null, nowMs), 0);
  });

  it("blocks refresh when generatedAt is within 5 minutes", () => {
    const recent = {
      generatedAt: new Date(nowMs - 2 * 60 * 1000).toISOString(),
    };
    assert.equal(isAiRefreshOnCooldown(recent, nowMs), true);
    assert.equal(msUntilAiRefreshAllowed(recent, nowMs), 3 * 60 * 1000);
  });

  it("allows refresh when generatedAt is older than 5 minutes", () => {
    const older = {
      generatedAt: new Date(nowMs - AI_REFRESH_COOLDOWN_MS - 1).toISOString(),
    };
    assert.equal(isAiRefreshOnCooldown(older, nowMs), false);
    assert.equal(msUntilAiRefreshAllowed(older, nowMs), 0);
  });

  it("blocks refresh at exactly 5 minutes minus one millisecond", () => {
    const almostExpired = {
      generatedAt: new Date(nowMs - AI_REFRESH_COOLDOWN_MS + 1).toISOString(),
    };
    assert.equal(isAiRefreshOnCooldown(almostExpired, nowMs), true);
  });

  it("allows refresh at exactly 5 minutes", () => {
    const expired = {
      generatedAt: new Date(nowMs - AI_REFRESH_COOLDOWN_MS).toISOString(),
    };
    assert.equal(isAiRefreshOnCooldown(expired, nowMs), false);
  });
});
