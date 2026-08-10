"use client";

import { useEffect } from "react";
import {
  createEmptyStartupTimingSnapshot,
  formatStartupTimingLines,
  parseStartupDebugFlag,
  parseStartupPreviewFlag,
  relativeMs,
  shouldActivateStartupPreview,
  type CrmStartupTimingSnapshot,
} from "@/lib/pwa/startup-timing";

declare global {
  interface Window {
    __crmStartupTiming?: CrmStartupTimingSnapshot & {
      marks?: Record<string, number>;
      dismissReason?: string;
      standalone?: boolean;
      startupPreview?: boolean;
      startupDebug?: boolean;
    };
    __crmDismissBootSplash?: (reason?: string) => void;
  }
}

const PREVIEW_MIN_VISIBLE_MS = 1000;

function updateDebugPanel(snapshot: CrmStartupTimingSnapshot): void {
  const panel = document.getElementById("crm-startup-debug");
  if (!panel) {
    return;
  }
  panel.textContent = formatStartupTimingLines(snapshot).join("\n");
}

export function CrmBootSplashDismiss() {
  useEffect(() => {
    const timing = window.__crmStartupTiming;
    const splashVisible =
      timing?.standalone === true || timing?.startupPreview === true;
    const preview = shouldActivateStartupPreview(
      parseStartupPreviewFlag(window.location.search),
      process.env.NODE_ENV !== "production",
    );
    const debug = parseStartupDebugFlag(window.location.search);

    if (timing) {
      timing.marks = timing.marks ?? {};
      timing.marks.reactHydrated = performance.now();
      timing.reactHydratedMs = Math.round(timing.marks.reactHydrated);
    }

    if (!splashVisible) {
      if (debug && timing) {
        updateDebugPanel({
          ...createEmptyStartupTimingSnapshot(),
          ...timing,
          navigationStartMs: timing.navigationStartMs ?? 0,
        });
      }
      return;
    }

    const dismiss = (reason: string) => {
      window.__crmDismissBootSplash?.(reason);
      if (debug && timing) {
        updateDebugPanel({
          ...createEmptyStartupTimingSnapshot(),
          ...timing,
          navigationStartMs: timing.navigationStartMs ?? 0,
          reactHydratedMs:
            timing.reactHydratedMs ??
            relativeMs(timing.navigationStartMs ?? 0, performance.now()),
        });
      }
    };

    const runDismiss = () => {
      if (preview) {
        const visibleAt = timing?.marks?.bootShellVisible ?? performance.now();
        const elapsed = performance.now() - visibleAt;
        const waitMs = Math.max(0, PREVIEW_MIN_VISIBLE_MS - elapsed);
        window.setTimeout(() => dismiss("preview-ready"), waitMs);
        return;
      }
      dismiss("hydrated");
    };

    runDismiss();

    return () => {
      // no-op
    };
  }, []);

  return null;
}
