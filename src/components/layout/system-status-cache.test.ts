import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  clearStatusCacheForTest,
  getStatusCache,
  setStatusCache,
  statusCacheRemainingMs,
} from "./system-status-cache";

const TTL = 50_000;

describe("system-status-cache", () => {
  beforeEach(() => {
    clearStatusCacheForTest();
  });

  describe("getStatusCache", () => {
    it("returns null when cache is empty", () => {
      assert.equal(getStatusCache(), null);
    });

    it("returns the cached status within TTL", () => {
      const now = Date.now();
      setStatusCache("online", now);
      assert.equal(getStatusCache(now + 1000), "online");
    });

    it("returns null after TTL expires", () => {
      const now = Date.now();
      setStatusCache("online", now);
      assert.equal(getStatusCache(now + TTL + 1), null);
    });

    it("still returns status at exactly TTL boundary (exclusive expiry)", () => {
      // Implementation uses `> TTL_MS` (strictly greater), so a value fetched
      // exactly TTL ms ago is still considered valid.
      const now = Date.now();
      setStatusCache("degraded", now);
      assert.equal(getStatusCache(now + TTL), "degraded");
    });

    it("returns null one ms past TTL boundary", () => {
      const now = Date.now();
      setStatusCache("degraded", now);
      assert.equal(getStatusCache(now + TTL + 1), null);
    });

    it("caches 'degraded' status", () => {
      const now = Date.now();
      setStatusCache("degraded", now);
      assert.equal(getStatusCache(now + 5_000), "degraded");
    });

    it("caches 'offline' status", () => {
      const now = Date.now();
      setStatusCache("offline", now);
      assert.equal(getStatusCache(now + 5_000), "offline");
    });

    it("returns latest value after overwrite", () => {
      const now = Date.now();
      setStatusCache("online", now);
      setStatusCache("degraded", now + 1_000);
      assert.equal(getStatusCache(now + 2_000), "degraded");
    });
  });

  describe("statusCacheRemainingMs", () => {
    it("returns 0 when cache is empty", () => {
      assert.equal(statusCacheRemainingMs(), 0);
    });

    it("returns approximate remaining TTL for a fresh entry", () => {
      const now = Date.now();
      setStatusCache("online", now);
      const remaining = statusCacheRemainingMs(now + 10_000);
      // Should be ~40000ms (TTL 50000 - elapsed 10000)
      assert.ok(remaining > 39_000 && remaining <= 40_000, `expected ~40000, got ${remaining}`);
    });

    it("returns 0 when cache entry is expired", () => {
      const now = Date.now();
      setStatusCache("online", now);
      assert.equal(statusCacheRemainingMs(now + TTL + 1), 0);
    });

    it("positive remaining ms indicates a cache hit will occur", () => {
      const now = Date.now();
      setStatusCache("online", now);
      const remaining = statusCacheRemainingMs(now + 1_000);
      assert.ok(remaining > 0);
      // Confirm getStatusCache agrees
      assert.equal(getStatusCache(now + 1_000), "online");
    });
  });

  describe("clearStatusCacheForTest", () => {
    it("removes a previously set entry", () => {
      const now = Date.now();
      setStatusCache("online", now);
      clearStatusCacheForTest();
      assert.equal(getStatusCache(now + 100), null);
    });
  });
});
