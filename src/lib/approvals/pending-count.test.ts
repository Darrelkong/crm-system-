import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCachedPendingApprovalCount,
  invalidatePendingApprovalCountCache,
  setCachedPendingApprovalCount,
} from "./pending-count-cache";
import { formatNotificationBadgeCount } from "@/lib/notifications/badge-count";

describe("pending approval count cache", () => {
  it("returns null before any entry is set", () => {
    invalidatePendingApprovalCountCache();
    assert.equal(getCachedPendingApprovalCount(), null);
  });

  it("returns the stored count within TTL", () => {
    invalidatePendingApprovalCountCache();
    const now = Date.now();
    setCachedPendingApprovalCount(5, now);
    assert.equal(getCachedPendingApprovalCount(now + 1000), 5);
  });

  it("returns null after TTL (60s) has elapsed", () => {
    invalidatePendingApprovalCountCache();
    const now = Date.now();
    setCachedPendingApprovalCount(3, now);
    assert.equal(getCachedPendingApprovalCount(now + 61_000), null);
  });

  it("returns null after invalidation", () => {
    setCachedPendingApprovalCount(7);
    invalidatePendingApprovalCountCache();
    assert.equal(getCachedPendingApprovalCount(), null);
  });

  it("overwrites previous entry", () => {
    const now = Date.now();
    setCachedPendingApprovalCount(2, now);
    setCachedPendingApprovalCount(8, now);
    assert.equal(getCachedPendingApprovalCount(now), 8);
  });
});

describe("approval badge count formatting (reuses formatNotificationBadgeCount)", () => {
  it("returns null for 0 (no badge)", () => {
    assert.equal(formatNotificationBadgeCount(0), null);
  });

  it("returns '1' for 1", () => {
    assert.equal(formatNotificationBadgeCount(1), "1");
  });

  it("returns '99' for 99", () => {
    assert.equal(formatNotificationBadgeCount(99), "99");
  });

  it("returns '99+' for 100", () => {
    assert.equal(formatNotificationBadgeCount(100), "99+");
  });

  it("returns '99+' for large numbers", () => {
    assert.equal(formatNotificationBadgeCount(999), "99+");
  });
});
