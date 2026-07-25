export type WatermarkClock = {
  /** Calibrated absolute ms (server-aligned). */
  nowMs: () => number;
  /** Apply a fresh server timestamp against the current performance mark. */
  calibrate: (serverNowMs: number) => void;
};

/**
 * Server-calibrated clock: base server time + performance.now() delta.
 * Avoids trusting a user-altered system clock for ongoing ticks.
 */
export function createWatermarkClock(initialServerNowMs: number): WatermarkClock {
  let baseServerMs = initialServerNowMs;
  let basePerfMs =
    typeof performance !== "undefined" ? performance.now() : 0;

  return {
    nowMs() {
      if (typeof performance === "undefined") {
        return baseServerMs;
      }
      return baseServerMs + (performance.now() - basePerfMs);
    },
    calibrate(serverNowMs: number) {
      if (!Number.isFinite(serverNowMs) || serverNowMs <= 0) return;
      baseServerMs = serverNowMs;
      basePerfMs =
        typeof performance !== "undefined" ? performance.now() : 0;
    },
  };
}

/** Validate `/api/system-time` JSON without trusting client clocks. */
export function parseSystemTimePayload(data: unknown): number | null {
  if (!data || typeof data !== "object" || !("now" in data)) return null;
  const now = (data as { now: unknown }).now;
  if (typeof now !== "number" || !Number.isFinite(now) || now <= 0) {
    return null;
  }
  return now;
}

export async function fetchSystemTimeMs(
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const response = await fetch("/api/system-time", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return parseSystemTimePayload(data);
  } catch {
    // Network errors, aborts, and JSON parse failures — keep last good clock.
    return null;
  }
}

/** Recalibrate interval: 7 minutes (within the 5–10 minute guidance). */
export const WATERMARK_RECALIBRATE_MS = 7 * 60 * 1000;
