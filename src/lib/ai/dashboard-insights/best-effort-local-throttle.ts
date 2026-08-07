import { DASHBOARD_AI_RATE_LIMIT_WINDOW_MS } from "./constants";
import type { DashboardAiInsightType } from "./types";

/**
 * Process-local throttle only. Not a security boundary across Workers or isolates.
 * Dashboard AI force-refresh rate limiting uses D1-backed `ai_usage_events`.
 */
const buckets = new Map<string, number>();

function buildThrottleKey(
  viewerId: string,
  insightType: DashboardAiInsightType,
): string {
  return `${viewerId}|${insightType}`;
}

export function bestEffortLocalThrottleDashboardAi(
  viewerId: string,
  insightType: DashboardAiInsightType,
  nowMs: number = Date.now(),
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const key = buildThrottleKey(viewerId, insightType);
  const nextAllowedAt = buckets.get(key) ?? 0;
  if (nowMs < nextAllowedAt) {
    return { allowed: false, retryAfterMs: nextAllowedAt - nowMs };
  }
  buckets.set(key, nowMs + DASHBOARD_AI_RATE_LIMIT_WINDOW_MS);
  return { allowed: true };
}

export function clearDashboardAiLocalThrottleForTests(): void {
  buckets.clear();
}
