const TTL_MS = 60_000;

type CacheEntry = {
  count: number;
  fetchedAt: number;
};

let cache: CacheEntry | null = null;

export function getCachedPendingApprovalCount(now = Date.now()): number | null {
  if (!cache) return null;
  if (now - cache.fetchedAt > TTL_MS) return null;
  return cache.count;
}

export function setCachedPendingApprovalCount(count: number, now = Date.now()): void {
  cache = { count, fetchedAt: now };
}

export function invalidatePendingApprovalCountCache(): void {
  cache = null;
}
