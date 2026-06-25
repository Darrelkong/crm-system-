"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/provider";
import {
  CRM_LAST_ACTIVITY_KEY,
  CRM_SESSION_BC,
  performSecurityLogout,
  readLastActivityMs,
  writeLastActivityMs,
} from "@/lib/auth/client-security";

type SyncMessage =
  | { type: "activity"; at: number }
  | { type: "logout"; reason: "idle" | "manual" };

export function IdleTimeoutProvider({
  idleMinutes,
  children,
}: {
  idleMinutes: number;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [showTimeout, setShowTimeout] = useState(false);
  const loggingOutRef = useRef(false);
  const idleMs = idleMinutes * 60 * 1000;

  const handleIdleLogout = useCallback(async () => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    setShowTimeout(true);
    await performSecurityLogout("idle");
  }, []);

  const recordActivity = useCallback(() => {
    const now = Date.now();
    writeLastActivityMs(now);
    try {
      const bc = new BroadcastChannel(CRM_SESSION_BC);
      bc.postMessage({ type: "activity", at: now } satisfies SyncMessage);
      bc.close();
    } catch {
      // ignore
    }
  }, []);

  const checkIdle = useCallback(async () => {
    const last = readLastActivityMs();
    if (last == null) {
      writeLastActivityMs();
      return;
    }
    if (Date.now() - last > idleMs) {
      await handleIdleLogout();
      return;
    }

    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.status === 401) {
        const data = (await res.json()) as { errorCode?: string };
        if (data.errorCode === "SESSION_IDLE_EXPIRED") {
          await handleIdleLogout();
        }
      }
    } catch {
      // ignore transient network errors
    }
  }, [handleIdleLogout, idleMs]);

  useEffect(() => {
    writeLastActivityMs();

    const events: Array<keyof WindowEventMap> = [
      "click",
      "keydown",
      "touchstart",
      "scroll",
      "mousemove",
    ];

    let throttleTimer: ReturnType<typeof setTimeout> | null = null;
    const onActivity = () => {
      if (loggingOutRef.current) return;
      if (throttleTimer) return;
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        recordActivity();
      }, 1000);
    };

    for (const eventName of events) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void checkIdle();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onStorage = (event: StorageEvent) => {
      if (event.key === CRM_LAST_ACTIVITY_KEY && event.newValue) {
        // Another tab updated activity — no action needed; timer uses shared value.
      }
    };
    window.addEventListener("storage", onStorage);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(CRM_SESSION_BC);
      bc.onmessage = (event: MessageEvent<SyncMessage>) => {
        if (event.data.type === "activity") {
          writeLastActivityMs(event.data.at);
        }
        if (event.data.type === "logout") {
          void handleIdleLogout();
        }
      };
    } catch {
      bc = null;
    }

    const interval = window.setInterval(() => {
      void checkIdle();
    }, 30_000);

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, onActivity);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
      if (throttleTimer) clearTimeout(throttleTimer);
      window.clearInterval(interval);
      bc?.close();
    };
  }, [checkIdle, handleIdleLogout, recordActivity]);

  if (!showTimeout) {
    return children;
  }

  return (
    <>
      {children}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
        <Card className="w-full max-w-md p-6 text-center">
          <h2 className="text-lg font-semibold text-slate-900">
            {t("security.sessionTimeoutTitle")}
          </h2>
          <p className="mt-3 text-sm text-slate-600">
            {t("auth.signedOutDueToInactivity")}
          </p>
          <Button
            type="button"
            className="mt-6 w-full"
            disabled
          >
            {t("auth.signingOut")}
          </Button>
        </Card>
      </div>
    </>
  );
}
