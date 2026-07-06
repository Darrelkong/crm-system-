/**
 * Pure helper functions for the idle-exempt hidden trigger and client guard.
 * No React imports — all logic here is fully unit-testable.
 */

export const IDLE_EXEMPT_TRIGGER_COUNT = 7;
export const IDLE_EXEMPT_TRIGGER_WINDOW_MS = 3_000;

/**
 * Add a new click timestamp and drop any that are older than the trigger window.
 * Returns the updated array (does NOT mutate the input).
 */
export function addClickTimestamp(
  timestamps: readonly number[],
  now: number,
): number[] {
  const recent = timestamps.filter(
    (t) => now - t <= IDLE_EXEMPT_TRIGGER_WINDOW_MS,
  );
  return [...recent, now];
}

/**
 * Return true when the timestamps array has reached the required trigger count.
 * Call AFTER addClickTimestamp.
 */
export function shouldTriggerIdleExempt(timestamps: readonly number[]): boolean {
  return timestamps.length >= IDLE_EXEMPT_TRIGGER_COUNT;
}

/**
 * Return true when the client-side idle exemption is still active.
 * This is a UX-only guard — the server is the sole security authority.
 */
export function isIdleExemptActive(
  exemptUntil: number | null,
  now: number,
): boolean {
  return exemptUntil !== null && now < exemptUntil;
}

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

export type ActivateApiOk = {
  ok: true;
  /** Expiry timestamp in milliseconds (Date.now() scale). */
  exemptUntil: number;
};

export type ActivateApiError = {
  ok: false;
  /** True when the feature is administratively disabled. */
  disabled: boolean;
  message: string;
};

export type ActivateApiResult = ActivateApiOk | ActivateApiError;

/**
 * Parse the HTTP status code and response body from POST /api/auth/activate-idle-exempt.
 * Returns a typed result without exposing internal details.
 */
export function parseActivateResponse(
  statusCode: number,
  data: unknown,
): ActivateApiResult {
  if (statusCode === 200) {
    const record =
      data !== null && typeof data === "object"
        ? (data as Record<string, unknown>)
        : {};
    if (record.ok === true && typeof record.exemptUntil === "string") {
      const ms = new Date(record.exemptUntil).getTime();
      if (!Number.isNaN(ms)) return { ok: true, exemptUntil: ms };
    }
    return { ok: false, disabled: false, message: "驗證失敗，請確認後再試。" };
  }

  if (statusCode === 403) {
    return { ok: false, disabled: true, message: "該操作已被限制，請聯絡管理員。" };
  }

  if (statusCode === 429) {
    return { ok: false, disabled: false, message: "嘗試次數過多，請稍後再試。" };
  }

  // 401 and all other errors
  return { ok: false, disabled: false, message: "驗證失敗，請確認後再試。" };
}
