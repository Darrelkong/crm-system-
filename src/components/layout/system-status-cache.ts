/**
 * Module-level cache for the system status badge result.
 *
 * Exporting the helpers (rather than keeping them private) allows unit tests
 * to verify cache hit / miss behaviour without mounting a React component.
 */

export type StableSystemStatus = "online" | "degraded" | "offline";

type StatusCacheEntry = {
  status: StableSystemStatus;
  fetchedAt: number;
};

const STATUS_CACHE_TTL_MS = 50_000;

let _cache: StatusCacheEntry | null = null;

export function getStatusCache(now = Date.now()): StableSystemStatus | null {
  if (!_cache) return null;
  if (now - _cache.fetchedAt > STATUS_CACHE_TTL_MS) return null;
  return _cache.status;
}

export function setStatusCache(
  status: StableSystemStatus,
  now = Date.now(),
): void {
  _cache = { status, fetchedAt: now };
}

/** Returns ms until the current cache entry expires, or 0 if expired/absent. */
export function statusCacheRemainingMs(now = Date.now()): number {
  if (!_cache) return 0;
  return Math.max(0, STATUS_CACHE_TTL_MS - (now - _cache.fetchedAt));
}

/** Reset for testing. */
export function clearStatusCacheForTest(): void {
  _cache = null;
}
