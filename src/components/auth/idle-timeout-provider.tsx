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
  getAccessReverifyRedirectPath,
  parseBroadcastLogoutReason,
  parseSessionEndReason,
  readLastActivityMs,
  redirectToLoginWithSessionEnd,
  sessionEndMessageKey,
  sessionEndShowsModal,
  shouldInspectSessionApiResponse,
  type SessionBroadcastLogoutReason,
  type SessionEndReason,
  writeLastActivityMs,
} from "@/lib/auth/client-security";
import { useIdleExempt } from "@/components/auth/idle-exempt-context";
import {
  interpretAuthMeResponse,
  planIdleCheckAfterMe,
} from "@/lib/auth/idle-timeout-check";

type SyncMessage =
  | { type: "activity"; at: number }
  | { type: "logout"; reason: SessionBroadcastLogoutReason };

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
  const globalIdleExemptRef = useRef(false);
  const idleMs = idleMinutes * 60 * 1000;
  const { exemptUntil } = useIdleExempt();

  const handleSessionEnd = useCallback(
    async (
      reason: SessionEndReason,
      options?: { fromBroadcast?: boolean },
    ) => {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;

      if (sessionEndShowsModal(reason)) {
        setSessionEndReason(reason);
      }

      if (!options?.fromBroadcast) {
        try {
          const bc = new BroadcastChannel(CRM_SESSION_BC);
          bc.postMessage({ type: "logout", reason } satisfies SyncMessage);
          bc.close();
        } catch {
          // ignore
        }
      }

      if (reason === "access_reverify") {
        // Dedicated path: clear CRM session, no idle modal, no timeout visit count.
        await clearSessionClientState("expired");
        window.location.href = getAccessReverifyRedirectPath();
        return;
      }

      const logoutReason = reason === "idle" ? "idle" : "expired";
      await clearSessionClientState(logoutReason);

      await new Promise((resolve) =>
        setTimeout(resolve, SESSION_END_REDIRECT_DELAY_MS),
      );
      redirectToLoginWithSessionEnd(reason);
    },
    [],
  );

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
    // Step 1: always poll /api/auth/me (even when exempt) for revoke / device /
    // access reverify / global idle flag. Network failures do not force logout.
    let meResult = interpretAuthMeResponse({ status: 0 });
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.status === 401) {
        let errorCode: string | undefined;
        try {
          const data = (await res.json()) as { errorCode?: string };
          errorCode = data.errorCode;
        } catch {
          // non-JSON 401 — ignore for forced logout
        }
        meResult = interpretAuthMeResponse({ status: 401, errorCode });
      } else if (res.ok) {
        let globalIdleTimeoutExempt: unknown = false;
        try {
          const data = (await res.json()) as {
            globalIdleTimeoutExempt?: unknown;
          };
          globalIdleTimeoutExempt = data.globalIdleTimeoutExempt;
        } catch {
          // treat as ignore / no global flag
        }
        meResult = interpretAuthMeResponse({
          status: res.status,
          globalIdleTimeoutExempt,
        });
      } else {
        meResult = interpretAuthMeResponse({ status: res.status });
      }
    } catch {
      meResult = interpretAuthMeResponse({ status: 0 });
    }

    if (meResult.kind === "ok") {
      globalIdleExemptRef.current = meResult.globalIdleTimeoutExempt;
    }

    // Session-end from me takes priority; network/ignore keeps last known global flag.
    const meForPlan =
      meResult.kind === "session_end"
        ? meResult
        : {
            kind: "ok" as const,
            globalIdleTimeoutExempt:
              meResult.kind === "ok"
                ? meResult.globalIdleTimeoutExempt
                : globalIdleExemptRef.current,
          };

    const plan = planIdleCheckAfterMe({
      me: meForPlan,
      idleExemptUntilMs: exemptUntil,
      nowMs: Date.now(),
      lastActivityMs: readLastActivityMs(),
      idleMs,
    });

    if (plan.type === "end_session") {
      await handleSessionEnd(plan.reason);
      return;
    }

    if (plan.type === "skip_local_idle") {
      return;
    }

    if (plan.type === "local_idle_expired") {
      await handleSessionEnd("idle");
      return;
    }

    // continue: seed activity if missing
    if (readLastActivityMs() == null) {
      writeLastActivityMs();
    }
  }, [handleSessionEnd, idleMs, exemptUntil]);

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

      if (!shouldInspectSessionApiResponse(requestUrl)) {
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
          const reason = parseBroadcastLogoutReason(event.data.reason);
          if (!reason) return;
          void handleSessionEnd(reason, { fromBroadcast: true });
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
