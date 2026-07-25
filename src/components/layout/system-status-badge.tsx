"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import {
  getStatusCache,
  invalidateStatusCache,
  setStatusCache,
  statusCacheRemainingMs,
  type StableSystemStatus,
} from "@/components/layout/system-status-cache";
import {
  RESUME_DEBOUNCE_MS,
  RESUME_MAX_ATTEMPTS,
  RESUME_REFRESH_TIMEOUT_MS,
  classifyResumeSessionProbe,
  createResumeRequestGate,
  planBackgroundHealthPoll,
  resumeHealthUrl,
  resumeRetryDelayMs,
  shouldAcceptGeneration,
  shouldRetryResumeAttempt,
  waitForRefreshTransition,
} from "@/components/layout/system-status-resume";
import { useIdleExempt } from "@/components/auth/idle-exempt-context";
import {
  addClickTimestamp,
  shouldTriggerIdleExempt,
} from "@/lib/auth/idle-exempt-ui";
import { interpretAuthMeResponse } from "@/lib/auth/idle-timeout-check";

type SystemStatus = "online" | "checking" | "degraded" | "offline";

const POLL_INTERVAL_MS = 45_000;
const FETCH_TIMEOUT_MS = 7_000;
/** Two consecutive background poll failures (~45s apart) before showing offline. */
const OFFLINE_AFTER_CONSECUTIVE_FAILURES = 2;

type FetchResult =
  | { ok: true; status: "online" | "degraded" }
  | { ok: false };

async function fetchSystemStatus(
  signal?: AbortSignal,
  url = "/api/health",
): Promise<FetchResult> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      window.clearTimeout(timeoutId);
      return { ok: false };
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false };

    const data = (await res.json()) as { status?: string };
    if (data.status === "ok") return { ok: true, status: "online" };
    if (data.status === "degraded") return { ok: true, status: "degraded" };
    return { ok: false };
  } catch {
    return { ok: false };
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function probeSession(signal?: AbortSignal): Promise<{
  meKind: "ok" | "session_end" | "ignore";
  fetchFailed: boolean;
}> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      window.clearTimeout(timeoutId);
      return { meKind: "ignore", fetchFailed: true };
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const res = await fetch("/api/auth/me", {
      cache: "no-store",
      signal: controller.signal,
    });

    if (res.status === 401) {
      let errorCode: string | undefined;
      try {
        const data = (await res.json()) as { errorCode?: string };
        errorCode = data.errorCode;
      } catch {
        // non-JSON 401
      }
      const interpreted = interpretAuthMeResponse({ status: 401, errorCode });
      return { meKind: interpreted.kind, fetchFailed: false };
    }

    if (res.ok) {
      let globalIdleTimeoutExempt: unknown = false;
      try {
        const data = (await res.json()) as {
          globalIdleTimeoutExempt?: unknown;
        };
        globalIdleTimeoutExempt = data.globalIdleTimeoutExempt;
      } catch {
        // ignore body parse errors — still authenticated HTTP-wise
      }
      const interpreted = interpretAuthMeResponse({
        status: res.status,
        globalIdleTimeoutExempt,
      });
      return { meKind: interpreted.kind, fetchFailed: false };
    }

    return {
      meKind: interpretAuthMeResponse({ status: res.status }).kind,
      fetchFailed: false,
    };
  } catch {
    return { meKind: "ignore", fetchFailed: true };
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = window.setTimeout(() => resolve(), ms);
    const onAbort = () => {
      window.clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const statusConfig: Record<
  SystemStatus,
  { dot: string; labelKey: string }
> = {
  online: { dot: "bg-emerald-500", labelKey: "systemStatus.online" },
  checking: { dot: "bg-slate-400", labelKey: "systemStatus.checking" },
  degraded: { dot: "bg-amber-500", labelKey: "systemStatus.degraded" },
  offline: { dot: "bg-red-500", labelKey: "systemStatus.offline" },
};

export function SystemStatusBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [isRefreshPending, startRefreshTransition] = useTransition();
  const isRefreshPendingRef = useRef(isRefreshPending);
  isRefreshPendingRef.current = isRefreshPending;

  const cachedOnMount = getStatusCache();
  // No reliable cache: start as checking (not optimistic green) until a probe finishes.
  const [status, setStatus] = useState<SystemStatus>(
    cachedOnMount ?? "checking",
  );
  const statusRef = useRef<SystemStatus>(cachedOnMount ?? "checking");
  const failureCountRef = useRef(0);
  const pollInFlightRef = useRef(false);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const { openModal, modalOpen } = useIdleExempt();
  const clickTimestampsRef = useRef<number[]>([]);

  function handleHiddenClick() {
    if (modalOpen) return;
    const now = Date.now();
    const updated = addClickTimestamp(clickTimestampsRef.current, now);
    if (shouldTriggerIdleExempt(updated)) {
      clickTimestampsRef.current = [];
      openModal();
    } else {
      clickTimestampsRef.current = updated;
    }
  }

  useEffect(() => {
    let cancelled = false;
    /** True after hide/blur/offline until a resume is requested. */
    let awaitingForegroundResume = false;

    function applyStatus(
      generation: number,
      next: SystemStatus,
      cache?: StableSystemStatus,
    ) {
      if (cancelled) return;
      if (!shouldAcceptGeneration(generationRef.current, generation)) return;
      statusRef.current = next;
      setStatus(next);
      if (cache) setStatusCache(cache);
    }

    /**
     * Background health poll — may degrade online→offline, but must never
     * alone upgrade offline/checking→online (that requires full resume).
     */
    async function pollHealthOnly() {
      if (pollInFlightRef.current) return;
      if (resumeGate.isRunning()) return;
      pollInFlightRef.current = true;
      const generation = generationRef.current;

      try {
        const result = await fetchSystemStatus();
        if (cancelled) return;
        if (!shouldAcceptGeneration(generationRef.current, generation)) return;

        const consecutiveFailuresAfterThis = result.ok
          ? 0
          : failureCountRef.current + 1;

        const plan = planBackgroundHealthPoll({
          currentStatus: statusRef.current,
          healthOk: result.ok,
          healthStatus: result.ok ? result.status : undefined,
          resumeRunning: resumeGate.isRunning(),
          consecutiveFailuresAfterThis,
          offlineAfterConsecutiveFailures: OFFLINE_AFTER_CONSECUTIVE_FAILURES,
        });

        switch (plan.action) {
          case "skip":
            return;
          case "keep":
            failureCountRef.current = 0;
            applyStatus(generation, plan.status, plan.status);
            return;
          case "request_resume":
            failureCountRef.current = 0;
            // Do not paint green from health-only; reuse the full resume entry.
            requestResume();
            return;
          case "set_offline":
            failureCountRef.current = consecutiveFailuresAfterThis;
            applyStatus(generation, "offline", "offline");
            return;
          case "set_checking":
            failureCountRef.current = consecutiveFailuresAfterThis;
            applyStatus(generation, "checking");
            return;
        }
      } finally {
        pollInFlightRef.current = false;
      }
    }

    /**
     * Full resume:
     * checking → session probe → startTransition(refresh) → wait pending →
     * live health → green only if health ok.
     */
    async function resumePage() {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const signal = controller.signal;
      generationRef.current += 1;
      const generation = generationRef.current;
      failureCountRef.current = 0;

      // Drop stale offline/online badge cache so remounts cannot re-apply red
      // from the previous 50s TTL while we are re-probing live.
      invalidateStatusCache();
      applyStatus(generation, "checking");

      let sessionOk = false;

      for (let attempt = 0; attempt < RESUME_MAX_ATTEMPTS; attempt++) {
        if (cancelled || signal.aborted) return;
        if (!shouldAcceptGeneration(generationRef.current, generation)) return;

        const delay = resumeRetryDelayMs(attempt);
        if (delay > 0) {
          try {
            await sleep(delay, signal);
          } catch {
            return;
          }
        }

        applyStatus(generation, "checking");
        const probe = await probeSession(signal);
        if (cancelled || signal.aborted) return;
        if (!shouldAcceptGeneration(generationRef.current, generation)) return;

        const classified = classifyResumeSessionProbe(probe);

        if (classified.kind === "session_end") {
          // IdleTimeoutProvider / fetch interceptor owns logout; stay red.
          applyStatus(generation, "offline", "offline");
          return;
        }

        if (classified.kind === "ok") {
          sessionOk = true;
          break;
        }

        if (!shouldRetryResumeAttempt(attempt)) {
          applyStatus(generation, "offline", "offline");
          return;
        }
      }

      if (!sessionOk) {
        applyStatus(generation, "offline", "offline");
        return;
      }

      // Soft-refresh Server Components; stay on checking until transition settles
      // (or timeout / never_pending fallback — then still require live health).
      applyStatus(generation, "checking");
      const transitionResult = await waitForRefreshTransition({
        startRefresh: () => {
          startRefreshTransition(() => {
            router.refresh();
          });
        },
        isPending: () => isRefreshPendingRef.current,
        signal,
        timeoutMs: RESUME_REFRESH_TIMEOUT_MS,
        sleep,
      });

      if (cancelled || signal.aborted || transitionResult === "aborted") return;
      if (!shouldAcceptGeneration(generationRef.current, generation)) return;

      // Keep checking through the final live health probe.
      applyStatus(generation, "checking");

      const health = await fetchSystemStatus(
        signal,
        resumeHealthUrl(Date.now()),
      );
      if (cancelled || signal.aborted) return;
      if (!shouldAcceptGeneration(generationRef.current, generation)) return;

      if (health.ok) {
        failureCountRef.current = 0;
        applyStatus(generation, health.status, health.status);
        return;
      }

      // Session + soft refresh path ran, but live health failed — do not show
      // a fake green; stay offline until a later successful probe.
      applyStatus(generation, "offline", "offline");
    }

    const resumeGate = createResumeRequestGate({
      delayMs: RESUME_DEBOUNCE_MS,
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      clear: (id) => window.clearTimeout(id),
    });

    const requestResume = () => {
      awaitingForegroundResume = false;
      resumeGate.request(() => resumePage());
    };

    // Offline (or empty) cache: resume immediately — do not wait out a stale red TTL.
    const cached = getStatusCache();
    const remaining = statusCacheRemainingMs();
    const initialDelay =
      cached === "offline" || cached == null ? 0 : remaining > 0 ? remaining : 0;

    const initial = window.setTimeout(() => {
      if (cached === "offline" || cached == null) {
        requestResume();
      } else {
        void pollHealthOnly();
      }
    }, initialDelay);

    const intervalId = window.setInterval(() => void pollHealthOnly(), POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        awaitingForegroundResume = true;
        return;
      }
      if (document.visibilityState === "visible") {
        requestResume();
      }
    };

    const onPageShow = (event: PageTransitionEvent) => {
      // BFCache restore (persisted) and Safari returning from background.
      if (event.persisted || document.visibilityState === "visible") {
        requestResume();
      }
    };

    const onBlur = () => {
      awaitingForegroundResume = true;
    };

    const onFocus = () => {
      // Supplement for desktop: only after prior blur/hide, not ordinary in-page clicks.
      if (!awaitingForegroundResume) return;
      if (document.visibilityState !== "visible") return;
      requestResume();
    };

    const onOnline = () => {
      requestResume();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      resumeGate.cancel();
      abortRef.current?.abort();
      window.clearTimeout(initial);
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [router, startRefreshTransition]);

  const config = statusConfig[status];

  return (
    <div
      className={cn(
        "status-badge gap-2 px-2.5 py-1.5",
        className,
      )}
      role="status"
      aria-live="polite"
      onClick={handleHiddenClick}
    >
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", config.dot)}
        aria-hidden
      />
      <span className="text-[10px] font-semibold tracking-wide crm-text-secondary sm:text-xs">
        {t(config.labelKey)}
      </span>
    </div>
  );
}
