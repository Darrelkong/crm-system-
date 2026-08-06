import { DASHBOARD_AI_RATE_LIMIT_WINDOW_MS } from "./constants";
import type { DashboardAiInsightType } from "./types";

const buckets = new Map<string, number>();

function buildRateLimitKey(
  viewerId: string,
  insightType: DashboardAiInsightType,
): string {
  return `${viewerId}|${insightType}`;
}

export function checkDashboardAiRateLimit(
  viewerId: string,
  insightType: DashboardAiInsightType,
  nowMs: number = Date.now(),
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const key = buildRateLimitKey(viewerId, insightType);
  const nextAllowedAt = buckets.get(key) ?? 0;
  if (nowMs < nextAllowedAt) {
    return { allowed: false, retryAfterMs: nextAllowedAt - nowMs };
  }
  buckets.set(key, nowMs + DASHBOARD_AI_RATE_LIMIT_WINDOW_MS);
  return { allowed: true };
}

export function clearDashboardAiRateLimitForTests(): void {
  buckets.clear();
}
