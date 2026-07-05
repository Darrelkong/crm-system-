import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  getCachedUnreadCount,
  setCachedUnreadCount,
  invalidateUnreadCountCache,
} from "./unread-count-cache";

const TTL = 60_000;

describe("unread-count-cache", () => {
  // Reset between tests by invalidating then setting known state.
  beforeEach(() => {
    invalidateUnreadCountCache();
  });

  it("returns null when cache is empty", () => {
    assert.equal(getCachedUnreadCount(), null);
  });

  it("returns the cached count within TTL", () => {
    const now = Date.now();
    setCachedUnreadCount(5, now);
    assert.equal(getCachedUnreadCount(now + 1_000), 5);
  });

  it("still returns value at exactly TTL boundary (exclusive expiry)", () => {
    // Implementation uses `> TTL_MS` (strictly greater), so a value fetched
    // exactly TTL ms ago is still considered valid.
    const now = Date.now();
    setCachedUnreadCount(7, now);
    assert.equal(getCachedUnreadCount(now + TTL), 7);
  });

  it("returns null one ms past TTL boundary", () => {
    const now = Date.now();
    setCachedUnreadCount(7, now);
    assert.equal(getCachedUnreadCount(now + TTL + 1), null);
  });

  it("returns 0 when zero unread stored", () => {
    const now = Date.now();
    setCachedUnreadCount(0, now);
    assert.equal(getCachedUnreadCount(now + 1_000), 0);
  });

  it("returns updated count after overwrite", () => {
    const now = Date.now();
    setCachedUnreadCount(2, now);
    setCachedUnreadCount(8, now + 500);
    assert.equal(getCachedUnreadCount(now + 1_000), 8);
  });

  it("returns null after invalidation", () => {
    const now = Date.now();
    setCachedUnreadCount(4, now);
    invalidateUnreadCountCache();
    assert.equal(getCachedUnreadCount(now + 100), null);
  });

  it("cache is independent: a re-set after invalidation works", () => {
    const now = Date.now();
    setCachedUnreadCount(3, now);
    invalidateUnreadCountCache();
    setCachedUnreadCount(9, now + 100);
    assert.equal(getCachedUnreadCount(now + 200), 9);
  });
});
