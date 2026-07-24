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

  it("blocks refresh when ready generatedAt is within 5 minutes", () => {
    const recent = {
      status: "ready",
      generatedAt: new Date(nowMs - 2 * 60 * 1000).toISOString(),
    };
    assert.equal(isAiRefreshOnCooldown(recent, nowMs), true);
    assert.equal(msUntilAiRefreshAllowed(recent, nowMs), 3 * 60 * 1000);
  });

  it("allows refresh when ready generatedAt is older than 5 minutes", () => {
    const older = {
      status: "ready",
      generatedAt: new Date(nowMs - AI_REFRESH_COOLDOWN_MS - 1).toISOString(),
    };
    assert.equal(isAiRefreshOnCooldown(older, nowMs), false);
    assert.equal(msUntilAiRefreshAllowed(older, nowMs), 0);
  });

  it("blocks refresh at exactly 5 minutes minus one millisecond", () => {
    const almostExpired = {
      status: "ready",
      generatedAt: new Date(nowMs - AI_REFRESH_COOLDOWN_MS + 1).toISOString(),
    };
    assert.equal(isAiRefreshOnCooldown(almostExpired, nowMs), true);
  });

  it("allows refresh at exactly 5 minutes", () => {
    const expired = {
      status: "ready",
      generatedAt: new Date(nowMs - AI_REFRESH_COOLDOWN_MS).toISOString(),
    };
    assert.equal(isAiRefreshOnCooldown(expired, nowMs), false);
  });

  it("does not cooldown failed insights even with recent generatedAt", () => {
    const failedRecent = {
      status: "failed",
      generatedAt: new Date(nowMs - 30_000).toISOString(),
    };
    assert.equal(isAiRefreshOnCooldown(failedRecent, nowMs), false);
    assert.equal(msUntilAiRefreshAllowed(failedRecent, nowMs), 0);
  });

  it("treats null/empty/invalid generatedAt as no cooldown", () => {
    assert.equal(
      isAiRefreshOnCooldown({ status: "ready", generatedAt: "" }, nowMs),
      false,
    );
    assert.equal(
      isAiRefreshOnCooldown({ status: "ready", generatedAt: "not-a-date" }, nowMs),
      false,
    );
  });

  it("does not permanently lock on future generatedAt", () => {
    const future = {
      status: "ready",
      generatedAt: new Date(nowMs + 60 * 60 * 1000).toISOString(),
    };
    assert.equal(isAiRefreshOnCooldown(future, nowMs), false);
    assert.equal(msUntilAiRefreshAllowed(future, nowMs), 0);
  });

  it("scopes cooldown by insight identity: A recent ready does not affect B", () => {
    const customerA = {
      status: "ready",
      generatedAt: new Date(nowMs - 60_000).toISOString(),
    };
    const customerB = {
      status: "ready",
      generatedAt: new Date(nowMs - AI_REFRESH_COOLDOWN_MS - 1).toISOString(),
    };
    const customerC = null;
    assert.equal(isAiRefreshOnCooldown(customerA, nowMs), true);
    assert.equal(isAiRefreshOnCooldown(customerB, nowMs), false);
    assert.equal(isAiRefreshOnCooldown(customerC, nowMs), false);
  });

  it("score 0 ready insight still participates in cooldown (status-based)", () => {
    // Cooldown must key off status+generatedAt, not score falsiness.
    const ready = {
      status: "ready",
      generatedAt: new Date(nowMs - 1_000).toISOString(),
    };
    assert.equal(isAiRefreshOnCooldown(ready, nowMs), true);
  });
});
