"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/i18n/provider";
import { cn } from "@/lib/cn";

type SystemStatus = "online" | "degraded" | "offline";

const POLL_INTERVAL_MS = 45_000;

async function fetchSystemStatus(): Promise<SystemStatus> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (!res.ok) return "offline";

    const data = (await res.json()) as { status?: string };
    if (data.status === "ok") return "online";
    if (data.status === "degraded") return "degraded";
    return "offline";
  } catch {
    return "offline";
  }
}

const statusConfig: Record<
  SystemStatus,
  { dot: string; labelKey: string }
> = {
  online: { dot: "bg-emerald-500", labelKey: "systemStatus.online" },
  degraded: { dot: "bg-amber-500", labelKey: "systemStatus.degraded" },
  offline: { dot: "bg-red-500", labelKey: "systemStatus.offline" },
};

export function SystemStatusBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SystemStatus>("online");

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const next = await fetchSystemStatus();
      if (!cancelled) setStatus(next);
    }

    const initial = window.setTimeout(() => void poll(), 0);
    const id = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(id);
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
      <span className="text-[10px] font-semibold tracking-wide text-[#6B7890] sm:text-xs">
        {t(config.labelKey)}
      </span>
    </div>
  );
}
