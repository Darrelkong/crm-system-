"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/provider";
import {
  CRM_LAST_ACTIVITY_KEY,
  CRM_SESSION_BC,
  SESSION_END_REDIRECT_DELAY_MS,
  clearSessionClientState,
  parseSessionEndReason,
  readLastActivityMs,
  redirectToLoginWithSessionEnd,
  sessionEndMessageKey,
  type SessionEndReason,
  writeLastActivityMs,
} from "@/lib/auth/client-security";
import { useIdleExempt } from "@/components/auth/idle-exempt-context";
import { isIdleExemptActive } from "@/lib/auth/idle-exempt-ui";

type SyncMessage =
  | { type: "activity"; at: number }
  | { type: "logout"; reason: "idle" | "revoked" | "invalid" | "manual" | "device_revoked" };

function shouldInspectSessionResponse(url: string): boolean {
  if (!url.includes("/api/")) return false;
  if (url.includes("/api/auth/login")) return false;
  if (url.includes("/api/auth/logout")) return false;
  return true;
}

export function IdleTimeoutProvider({
  idleMinutes,
  children,
}: {
  idleMinutes: number;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [sessionEndReason, setSessionEndReason] = useState<SessionEndReason | null>(
    null,
  );
  const loggingOutRef = useRef(false);
  const idleMs = idleMinutes * 60 * 1000;
  const { exemptUntil } = useIdleExempt();

  const handleSessionEnd = useCallback(async (reason: SessionEndReason) => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    setSessionEndReason(reason);

    try {
      const bc = new BroadcastChannel(CRM_SESSION_BC);
      bc.postMessage({ type: "logout", reason } satisfies SyncMessage);
      bc.close();
    } catch {
      // ignore
    }

    const logoutReason = reason === "idle" ? "idle" : "expired";
    await clearSessionClientState(logoutReason);

    await new Promise((resolve) =>
      setTimeout(resolve, SESSION_END_REDIRECT_DELAY_MS),
    );
    redirectToLoginWithSessionEnd(reason);
  }, []);

  const handleApiSessionEnd = useCallback(
    async (errorCode?: string) => {
      const reason = parseSessionEndReason(errorCode);
      if (!reason) return;
      await handleSessionEnd(reason);
    },
    [handleSessionEnd],
  );

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
    // Client-side UX guard: skip local idle redirect while exemption is active.
    // The server remains the sole security authority; this only prevents an
    // unnecessary client-triggered redirect when the user deliberately opted in.
    if (isIdleExemptActive(exemptUntil, Date.now())) {
      return;
    }

    const last = readLastActivityMs();
    if (last == null) {
      writeLastActivityMs();
      return;
    }
    if (Date.now() - last > idleMs) {
      await handleSessionEnd("idle");
      return;
    }

    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.status === 401) {
        const data = (await res.json()) as { errorCode?: string };
        await handleApiSessionEnd(data.errorCode);
      }
    } catch {
      // ignore transient network errors
    }
  }, [handleApiSessionEnd, handleSessionEnd, idleMs, exemptUntil]);

  useEffect(() => {
    writeLastActivityMs();

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (loggingOutRef.current || response.status !== 401) {
        return response;
      }

      const requestUrl =
        typeof args[0] === "string"
          ? args[0]
          : args[0] instanceof Request
            ? args[0].url
            : String(args[0]);

      if (!shouldInspectSessionResponse(requestUrl)) {
        return response;
      }

      try {
        const data = (await response.clone().json()) as { errorCode?: string };
        void handleApiSessionEnd(data.errorCode);
      } catch {
        // ignore non-JSON 401 responses
      }

      return response;
    };

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
          if (event.data.reason === "manual") return;
          void handleSessionEnd(
            event.data.reason === "revoked"
              ? "revoked"
              : event.data.reason === "invalid"
                ? "invalid"
                : "idle",
          );
        }
      };
    } catch {
      bc = null;
    }

    const interval = window.setInterval(() => {
      void checkIdle();
    }, 30_000);

    return () => {
      window.fetch = originalFetch;
      for (const eventName of events) {
        window.removeEventListener(eventName, onActivity);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
      if (throttleTimer) clearTimeout(throttleTimer);
      window.clearInterval(interval);
      bc?.close();
    };
  }, [checkIdle, handleApiSessionEnd, handleSessionEnd, recordActivity]);

  if (!sessionEndReason) {
    return children;
  }

  const titleKey =
    sessionEndReason === "revoked"
      ? "security.sessionRevokedTitle"
      : "security.sessionTimeoutTitle";

  return (
    <>
      {children}
      <div className="modal-overlay">
        <Card className="w-full max-w-md p-6 text-center">
          <h2 className="text-lg font-semibold text-[#172033]">{t(titleKey)}</h2>
          <p className="mt-3 text-sm text-[#6B7890]">
            {t(sessionEndMessageKey(sessionEndReason))}
          </p>
          <Button type="button" className="mt-6 w-full" disabled>
            {t("auth.redirectingToLogin")}
          </Button>
        </Card>
      </div>
    </>
  );
}
