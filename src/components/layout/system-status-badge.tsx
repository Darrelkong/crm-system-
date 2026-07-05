"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import {
  getStatusCache,
  setStatusCache,
  statusCacheRemainingMs,
  type StableSystemStatus,
} from "@/components/layout/system-status-cache";

type SystemStatus = "online" | "checking" | "degraded" | "offline";

const POLL_INTERVAL_MS = 45_000;
const FETCH_TIMEOUT_MS = 7_000;
/** Two consecutive poll failures (~45s apart) before showing offline. */
const OFFLINE_AFTER_CONSECUTIVE_FAILURES = 2;

type FetchResult =
  | { ok: true; status: "online" | "degraded" }
  | { ok: false };

async function fetchSystemStatus(): Promise<FetchResult> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch("/api/health", {
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
  }
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
  const cachedOnMount = getStatusCache();
  const [status, setStatus] = useState<SystemStatus>(cachedOnMount ?? "online");
  const failureCountRef = useRef(0);
  const pollInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;

      try {
        const result = await fetchSystemStatus();
        if (cancelled) return;

        if (result.ok) {
          failureCountRef.current = 0;
          setStatus(result.status);
          setStatusCache(result.status);
          return;
        }

        failureCountRef.current += 1;
        if (failureCountRef.current >= OFFLINE_AFTER_CONSECUTIVE_FAILURES) {
          const s = "offline" as StableSystemStatus;
          setStatus(s);
          setStatusCache(s);
        } else {
          setStatus("checking");
          // "checking" is transient — not worth caching
        }
      } finally {
        pollInFlightRef.current = false;
      }
    }

    // If a fresh status is already in the module cache, delay the first network
    // request until the cache expires. This avoids hitting /api/health on every
    // DashboardShell remount (cross-segment navigation).
    const remaining = statusCacheRemainingMs();
    const initialDelay = remaining > 0 ? remaining : 0;

    const initial = window.setTimeout(() => void poll(), initialDelay);
    const intervalId = window.setInterval(() => void poll(), POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const config = statusConfig[status];

  return (
    <div
      className={cn(
        "status-badge gap-2 px-2.5 py-1.5",
        className,
      )}
      role="status"
      aria-live="polite"
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
