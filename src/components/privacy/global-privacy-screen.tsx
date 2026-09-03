"use client";

import { useEffect, useRef, useState } from "react";

export const GLOBAL_PRIVACY_IDLE_MS = 120_000;
export const GLOBAL_PRIVACY_DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

export type GlobalPrivacyReason = "hidden" | "idle" | null;

export function GlobalPrivacyScreen() {
  const [privacyReason, setPrivacyReason] =
    useState<GlobalPrivacyReason>(null);
  const privacyReasonRef = useRef<GlobalPrivacyReason>(null);
  const idleTimerRef = useRef<number | null>(null);
  const activityThrottleRef = useRef<number | null>(null);

  useEffect(() => {
    const desktopQuery = window.matchMedia(
      GLOBAL_PRIVACY_DESKTOP_MEDIA_QUERY,
    );

    const clearIdleTimer = () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };

    const clearActivityThrottle = () => {
      if (activityThrottleRef.current !== null) {
        window.clearTimeout(activityThrottleRef.current);
        activityThrottleRef.current = null;
      }
    };

    const showPrivacyReason = (
      reason: Exclude<GlobalPrivacyReason, null>,
    ) => {
      if (privacyReasonRef.current === reason) return;
      privacyReasonRef.current = reason;
      setPrivacyReason(reason);
    };

    const clearPrivacyReason = () => {
      if (privacyReasonRef.current === null) return;
      privacyReasonRef.current = null;
      setPrivacyReason(null);
    };

    const armIdleTimer = () => {
      clearIdleTimer();
      if (
        !desktopQuery.matches ||
        document.visibilityState !== "visible"
      ) {
        return;
      }
      idleTimerRef.current = window.setTimeout(() => {
        idleTimerRef.current = null;
        showPrivacyReason("idle");
      }, GLOBAL_PRIVACY_IDLE_MS);
    };

    const restoreIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearPrivacyReason();
      armIdleTimer();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearIdleTimer();
        clearActivityThrottle();
        showPrivacyReason("hidden");
        return;
      }
      restoreIfVisible();
    };

    const onPageHide = () => {
      clearIdleTimer();
      clearActivityThrottle();
      showPrivacyReason("hidden");
    };

    const onPageShow = () => {
      restoreIfVisible();
    };

    const onFocus = () => {
      restoreIfVisible();
    };

    const onBlur = () => {
      if (document.visibilityState === "hidden") {
        showPrivacyReason("hidden");
      }
    };

    const onActivity = () => {
      if (document.visibilityState !== "visible") return;

      // Activity restores an idle screen immediately, including pointer movement.
      clearPrivacyReason();
      if (activityThrottleRef.current !== null) return;
      activityThrottleRef.current = window.setTimeout(() => {
        activityThrottleRef.current = null;
        armIdleTimer();
      }, 100);
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "pointermove",
      "mousemove",
      "pointerdown",
      "mousedown",
      "keydown",
      "wheel",
      "scroll",
      "touchstart",
    ];

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }

    const onDesktopQueryChange = () => {
      if (!desktopQuery.matches) {
        clearIdleTimer();
        clearActivityThrottle();
        if (privacyReasonRef.current === "idle") {
          clearPrivacyReason();
        }
        return;
      }
      armIdleTimer();
    };
    desktopQuery.addEventListener("change", onDesktopQueryChange);

    if (document.visibilityState === "hidden") {
      showPrivacyReason("hidden");
    } else {
      armIdleTimer();
    }

    return () => {
      clearIdleTimer();
      clearActivityThrottle();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, onActivity);
      }
      desktopQuery.removeEventListener("change", onDesktopQueryChange);
    };
  }, []);

  if (privacyReason === null) return null;

  return (
    <div
      className="global-privacy-screen"
      aria-hidden="true"
      data-privacy-reason={privacyReason}
    >
      <div className="global-privacy-screen__branding">
        <span
          className="global-privacy-screen__logo"
          role="img"
          aria-label="ECHFRONT logo"
        />
        <span className="global-privacy-screen__wordmark">ECHFRONT</span>
      </div>
    </div>
  );
}
