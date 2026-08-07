import type { DashboardAiInsightType } from "./types";
import { DASHBOARD_AI_CACHE_TTL_MS } from "./constants";
import type { DashboardAiInsightResult } from "./types";

type CacheEntry = {
  expiresAt: number;
  result: DashboardAiInsightResult;
};

/** Best-effort in-process cache; not shared across Workers or isolates. */
const cache = new Map<string, CacheEntry>();

export function buildDashboardAiCacheKey(input: {
  viewerId: string;
  viewerRole: string;
  insightType: DashboardAiInsightType;
  locale: string;
  fingerprint: string;
}): string {
  return [
    input.viewerRole,
    input.viewerId,
    input.insightType,
    input.locale,
    input.fingerprint,
  ].join("|");
}

export function getDashboardAiCache(
  key: string,
  nowMs: number = Date.now(),
): DashboardAiInsightResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs) {
    cache.delete(key);
    return null;
  }
  return { ...entry.result, cacheHit: true };
}

export function setDashboardAiCache(
  key: string,
  result: DashboardAiInsightResult,
  nowMs: number = Date.now(),
): void {
  cache.set(key, {
    expiresAt: nowMs + DASHBOARD_AI_CACHE_TTL_MS,
    result,
  });
}

export function clearDashboardAiCacheForTests(): void {
  cache.clear();
}
