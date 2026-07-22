import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateQuickEntryGrantStatus } from "@/lib/public-pool/quick-entry-security";
import type { QuickEntryInternalSettings } from "@/lib/public-pool/quick-entry-settings";

const baseSettings: QuickEntryInternalSettings = {
  enabled: true,
  codeHash: "hash",
  hasCode: true,
  codeUpdatedAt: "2026-07-20T00:00:00.000Z",
  codeUpdatedBy: "admin-1",
  grantVersion: 3,
};

describe("evaluateQuickEntryGrantStatus", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");

  it("active when enabled, version matches, grant not expired, unlocked", () => {
    const status = evaluateQuickEntryGrantStatus({
      settings: baseSettings,
      grantUntil: "2026-07-20T12:30:00.000Z",
      grantVersion: 3,
      lockedUntil: null,
      now,
    });
    assert.equal(status.grantActive, true);
    assert.equal(status.grantExpiresAt, "2026-07-20T12:30:00.000Z");
    assert.equal(status.locked, false);
  });

  it("inactive when disabled", () => {
    const status = evaluateQuickEntryGrantStatus({
      settings: { ...baseSettings, enabled: false },
      grantUntil: "2026-07-20T12:30:00.000Z",
      grantVersion: 3,
      lockedUntil: null,
      now,
    });
    assert.equal(status.enabled, false);
    assert.equal(status.grantActive, false);
    assert.equal(status.grantExpiresAt, null);
  });

  it("inactive on version mismatch", () => {
    const status = evaluateQuickEntryGrantStatus({
      settings: baseSettings,
      grantUntil: "2026-07-20T12:30:00.000Z",
      grantVersion: 2,
      lockedUntil: null,
      now,
    });
    assert.equal(status.grantActive, false);
  });

  it("inactive when grant expired", () => {
    const status = evaluateQuickEntryGrantStatus({
      settings: baseSettings,
      grantUntil: "2026-07-20T11:59:00.000Z",
      grantVersion: 3,
      lockedUntil: null,
      now,
    });
    assert.equal(status.grantActive, false);
  });

  it("locked with retryAfterSeconds", () => {
    const status = evaluateQuickEntryGrantStatus({
      settings: baseSettings,
      grantUntil: "2026-07-20T12:30:00.000Z",
      grantVersion: 3,
      lockedUntil: "2026-07-20T12:10:00.000Z",
      now,
    });
    assert.equal(status.locked, true);
    assert.equal(status.grantActive, false);
    assert.equal(status.retryAfterSeconds, 600);
  });
});
