/**
 * Pure helpers for CRM page-resume / system-status recovery.
 * Keeps debounce, generation gating, and retry policy testable without React.
 */

export const RESUME_DEBOUNCE_MS = 400;
export const RESUME_MAX_ATTEMPTS = 3;
/** Delay before attempt index 0 / 1 / 2 (ms). */
export const RESUME_RETRY_DELAYS_MS = [0, 600, 1_500] as const;
/**
 * Max time to wait for React isPending after startTransition(router.refresh).
 * Prevents the badge from staying on "checking" forever if the transition
 * never reports pending/settled (known Next.js limitation).
 */
export const RESUME_REFRESH_TIMEOUT_MS = 12_000;
export const RESUME_REFRESH_POLL_MS = 50;

export function shouldAcceptGeneration(
  activeGeneration: number,
  resultGeneration: number,
): boolean {
  return activeGeneration === resultGeneration;
}

/** Badge display statuses relevant to background health polling. */
export type BackgroundPollStatus =
  | "online"
  | "checking"
  | "degraded"
  | "offline";

export type BackgroundHealthPlan =
  | { action: "skip" }
  | { action: "keep"; status: "online" | "degraded" }
  | { action: "set_offline" }
  | { action: "set_checking" }
  | { action: "request_resume" };

/**
 * Background /api/health poll may degrade (green→red) but must never alone
 * upgrade offline/checking → online. Recovery requires a full resume.
 */
export function planBackgroundHealthPoll(input: {
  currentStatus: BackgroundPollStatus;
  healthOk: boolean;
  healthStatus?: "online" | "degraded";
  resumeRunning: boolean;
  /** Failure count after applying this poll's failure (0 if healthOk). */
  consecutiveFailuresAfterThis: number;
  offlineAfterConsecutiveFailures: number;
}): BackgroundHealthPlan {
  if (input.resumeRunning) {
    return { action: "skip" };
  }

  if (input.currentStatus === "checking") {
    // Do not paint green from health-only; schedule full resume if idle.
    if (input.healthOk) {
      return { action: "request_resume" };
    }
    if (
      input.consecutiveFailuresAfterThis >=
      input.offlineAfterConsecutiveFailures
    ) {
      return { action: "set_offline" };
    }
    // Leave checking alone (e.g. first failure after online).
    return { action: "skip" };
  }

  if (input.healthOk) {
    if (
      input.currentStatus === "online" ||
      input.currentStatus === "degraded"
    ) {
      return {
        action: "keep",
        status: input.healthStatus ?? "online",
      };
    }
    // offline → health recovered: full resume only, never direct green.
    if (input.currentStatus === "offline") {
      return { action: "request_resume" };
    }
    return { action: "skip" };
  }

  // health failed
  if (input.currentStatus === "online" || input.currentStatus === "degraded") {
    if (
      input.consecutiveFailuresAfterThis >=
      input.offlineAfterConsecutiveFailures
    ) {
      return { action: "set_offline" };
    }
    return { action: "set_checking" };
  }

  if (input.currentStatus === "offline") {
    return { action: "set_offline" };
  }

  return { action: "skip" };
}

export type ResumeSessionProbe =
  | { kind: "ok" }
  | { kind: "session_end" }
  | { kind: "transient" };

/**
 * Map /api/auth/me interpretation (+ fetch failure) to resume probe outcome.
 * Transient = retry; session_end = stop and stay offline (existing logout flow).
 */
export function classifyResumeSessionProbe(input: {
  meKind: "ok" | "session_end" | "ignore";
  fetchFailed: boolean;
}): ResumeSessionProbe {
  if (input.fetchFailed) return { kind: "transient" };
  if (input.meKind === "session_end") return { kind: "session_end" };
  if (input.meKind === "ignore") return { kind: "transient" };
  return { kind: "ok" };
}

export function resumeRetryDelayMs(attemptIndex: number): number {
  const delays = RESUME_RETRY_DELAYS_MS;
  if (attemptIndex < 0) return delays[0];
  if (attemptIndex >= delays.length) return delays[delays.length - 1];
  return delays[attemptIndex];
}

export function shouldRetryResumeAttempt(
  attemptIndexZeroBased: number,
  maxAttempts = RESUME_MAX_ATTEMPTS,
): boolean {
  return attemptIndexZeroBased + 1 < maxAttempts;
}

type ScheduleFn = (fn: () => void, ms: number) => number;
type ClearFn = (id: number) => void;

/**
 * Coalesce bursty resume events into one run; ignore overlapping runs.
 */
export function createResumeRequestGate(options: {
  delayMs: number;
  schedule: ScheduleFn;
  clear: ClearFn;
}) {
  let timer: number | null = null;
  let running = false;

  return {
    request(run: () => Promise<void>): void {
      if (running) return;
      if (timer != null) options.clear(timer);
      timer = options.schedule(() => {
        timer = null;
        if (running) return;
        running = true;
        void run().finally(() => {
          running = false;
        });
      }, options.delayMs);
    },
    isRunning(): boolean {
      return running;
    },
    cancel(): void {
      if (timer != null) options.clear(timer);
      timer = null;
    },
  };
}

export type RefreshTransitionWaitResult =
  | "completed"
  | "timeout"
  | "aborted"
  | "never_pending";

/**
 * After `startRefresh()` (typically `startTransition(() => router.refresh())`),
 * wait until `isPending()` has been true at least once and then returns to false.
 *
 * If pending is never observed within a short grace window, returns
 * `never_pending` so callers can fall through to a live health probe instead of
 * hanging. Absolute `timeoutMs` avoids infinite "checking".
 *
 * This tracks React transition pending state only — not a guarantee that every
 * Server Component fetch finished (Next.js does not expose that Promise).
 */
export async function waitForRefreshTransition(input: {
  startRefresh: () => void;
  isPending: () => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  pollMs?: number;
  /** How long to wait to observe isPending===true before giving up. */
  pendingGraceMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): Promise<RefreshTransitionWaitResult> {
  const timeoutMs = input.timeoutMs ?? RESUME_REFRESH_TIMEOUT_MS;
  const pollMs = input.pollMs ?? RESUME_REFRESH_POLL_MS;
  const pendingGraceMs = input.pendingGraceMs ?? 250;
  const now = input.now ?? Date.now;
  const sleepFn =
    input.sleep ??
    (async (ms: number, signal?: AbortSignal) => {
      if (ms <= 0) return;
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        const id = setTimeout(() => resolve(), ms);
        const onAbort = () => {
          clearTimeout(id);
          reject(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    });

  if (input.signal?.aborted) return "aborted";

  input.startRefresh();

  const absoluteDeadline = now() + timeoutMs;
  const pendingDeadline = now() + pendingGraceMs;
  let sawPending = input.isPending();

  try {
    while (!sawPending && now() < pendingDeadline) {
      if (input.signal?.aborted) return "aborted";
      if (now() >= absoluteDeadline) return "timeout";
      await sleepFn(pollMs, input.signal);
      sawPending = input.isPending();
    }

    if (!sawPending) {
      return "never_pending";
    }

    while (input.isPending()) {
      if (input.signal?.aborted) return "aborted";
      if (now() >= absoluteDeadline) return "timeout";
      await sleepFn(pollMs, input.signal);
    }

    return "completed";
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      return "aborted";
    }
    throw error;
  }
}

/** Live health URL for resume — bypasses any intermediary GET cache by query. */
export function resumeHealthUrl(nowMs = Date.now()): string {
  return `/api/health?resume=${nowMs}`;
}
