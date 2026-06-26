import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RECYCLE_BIN_RETENTION_DAYS,
  getRecycleBinRetentionCutoffIso,
  isRecycleBinRetentionExpired,
} from "./constants";
import { computeRemainingRetentionDays } from "./queries";

describe("customer recycle bin retention", () => {
  const now = new Date("2026-06-26T12:00:00.000Z");

  it("retention period is 90 days", () => {
    assert.equal(RECYCLE_BIN_RETENTION_DAYS, 90);
  });

  it("computes remaining retention days within the window", () => {
    const deletedAt = "2026-06-16T12:00:00.000Z";
    assert.equal(computeRemainingRetentionDays(deletedAt, now), 80);
  });

  it("marks customers at day 90 as expired (0 remaining days)", () => {
    const deletedAt = "2026-03-28T12:00:00.000Z";
    assert.equal(computeRemainingRetentionDays(deletedAt, now), 0);
  });

  it("marks customers beyond 90 days as negative remaining days", () => {
    const deletedAt = "2026-03-27T12:00:00.000Z";
    assert.equal(computeRemainingRetentionDays(deletedAt, now), -1);
  });

  it("does not purge customers deleted within 90 days", () => {
    const deletedAt = "2026-06-01T12:00:00.000Z";
    assert.equal(isRecycleBinRetentionExpired(deletedAt, now), false);
  });

  it("purges customers deleted more than 90 days ago", () => {
    const deletedAt = "2026-03-01T12:00:00.000Z";
    assert.equal(isRecycleBinRetentionExpired(deletedAt, now), true);
  });

  it("uses strict before-cutoff comparison for purge eligibility", () => {
    const cutoff = getRecycleBinRetentionCutoffIso(now);
    const exactlyAtCutoff = cutoff;
    const oneMsBeforeCutoff = new Date(
      new Date(cutoff).getTime() - 1,
    ).toISOString();

    assert.equal(isRecycleBinRetentionExpired(exactlyAtCutoff, now), false);
    assert.equal(isRecycleBinRetentionExpired(oneMsBeforeCutoff, now), true);
  });
});
