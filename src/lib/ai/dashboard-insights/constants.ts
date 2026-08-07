export const DASHBOARD_AI_MAX_HEADLINE_LENGTH = 120;
export const DASHBOARD_AI_MAX_SUMMARY_LENGTH = 600;
export const DASHBOARD_AI_MAX_TITLE_LENGTH = 120;
export const DASHBOARD_AI_MAX_REASON_LENGTH = 300;
export const DASHBOARD_AI_MAX_CAUTION_LENGTH = 200;
export const DASHBOARD_AI_MAX_PRIORITIES = 6;
export const DASHBOARD_AI_MAX_ACTIONS = 8;
export const DASHBOARD_AI_MAX_CAUTIONS = 4;
export const DASHBOARD_AI_MAX_STAFF_CANDIDATES = 20;

/** Per-user refresh window for dashboard AI (seconds). */
export const DASHBOARD_AI_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * In-process cache TTL (ms). Best-effort only; not shared across Workers.
 * Cache is never used for authorization — misses still re-run permission checks.
 */
export const DASHBOARD_AI_CACHE_TTL_MS = 5 * 60_000;

/** Provider timeout is read from effective `ai_timeout_ms` (default 30000 in ai-keys). */

export const DASHBOARD_AI_PROVIDER_MAX_RESPONSE_CHARS = 12_000;

export const DASHBOARD_AI_TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);

export const DASHBOARD_AI_TRANSIENT_MAX_ATTEMPTS = 2;

export const DASHBOARD_AI_TRANSIENT_BACKOFF_MS = [400] as const;
