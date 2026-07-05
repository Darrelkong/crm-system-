import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  getCachedPendingApprovalCount,
  setCachedPendingApprovalCount,
  invalidatePendingApprovalCountCache,
} from "./pending-count-cache";

const TTL = 60_000;

describe("pending-count-cache", () => {
  beforeEach(() => {
    invalidatePendingApprovalCountCache();
  });

  it("returns null when cache is empty", () => {
    assert.equal(getCachedPendingApprovalCount(), null);
  });

  it("returns the cached count within TTL", () => {
    const now = Date.now();
    setCachedPendingApprovalCount(2, now);
    assert.equal(getCachedPendingApprovalCount(now + 1_000), 2);
  });

  it("still returns value at exactly TTL boundary (exclusive expiry)", () => {
    // Implementation uses `> TTL_MS` (strictly greater), so a value fetched
    // exactly TTL ms ago is still considered valid.
    const now = Date.now();
    setCachedPendingApprovalCount(5, now);
    assert.equal(getCachedPendingApprovalCount(now + TTL), 5);
  });

  it("returns null one ms past TTL boundary", () => {
    const now = Date.now();
    setCachedPendingApprovalCount(1, now);
    assert.equal(getCachedPendingApprovalCount(now + TTL + 1), null);
  });

  it("returns 0 when zero pending stored", () => {
    const now = Date.now();
    setCachedPendingApprovalCount(0, now);
    assert.equal(getCachedPendingApprovalCount(now + 100), 0);
  });

  it("returns updated count after overwrite", () => {
    const now = Date.now();
    setCachedPendingApprovalCount(3, now);
    setCachedPendingApprovalCount(7, now + 500);
    assert.equal(getCachedPendingApprovalCount(now + 1_000), 7);
  });

  it("returns null after invalidation", () => {
    const now = Date.now();
    setCachedPendingApprovalCount(4, now);
    invalidatePendingApprovalCountCache();
    assert.equal(getCachedPendingApprovalCount(now + 100), null);
  });

  it("cache is independent: a re-set after invalidation works", () => {
    const now = Date.now();
    setCachedPendingApprovalCount(2, now);
    invalidatePendingApprovalCountCache();
    setCachedPendingApprovalCount(6, now + 100);
    assert.equal(getCachedPendingApprovalCount(now + 200), 6);
  });
});
