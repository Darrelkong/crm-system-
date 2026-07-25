"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "@/i18n/provider";
import { formatHongKongDateTimeSeconds } from "@/lib/timezone";
import {
  buildWatermarkIdentityLine,
  fitWatermarkDesktopFirstLine,
  fitWatermarkIdentity,
} from "@/components/security/watermark-identity";
import { watermarkOffsetFromSeed } from "@/components/security/watermark-offset";
import {
  WATERMARK_RECALIBRATE_MS,
  createWatermarkClock,
  fetchSystemTimeMs,
} from "@/components/security/watermark-time";

type Breakpoint = "mobile" | "tablet" | "desktop";

type TileSpec = {
  width: number;
  height: number;
  identityBase: number;
  identityMin: number;
  secondary: number;
  identityMaxWidth: number;
};

const TILE_BY_BREAKPOINT: Record<Breakpoint, TileSpec> = {
  mobile: {
    width: 220,
    height: 142,
    identityBase: 11.5,
    identityMin: 8.5,
    secondary: 9.5,
    identityMaxWidth: 195,
  },
  tablet: {
    width: 270,
    height: 158,
    identityBase: 12.5,
    identityMin: 8.5,
    secondary: 10,
    identityMaxWidth: 255,
  },
  desktop: {
    width: 320,
    height: 176,
    identityBase: 13.5,
    identityMin: 9,
    secondary: 10.5,
    identityMaxWidth: 300,
  },
};

function readBreakpoint(): Breakpoint {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia("(max-width: 639px)").matches) return "mobile";
  if (window.matchMedia("(max-width: 1023px)").matches) return "tablet";
  return "desktop";
}

function subscribeNoop() {
  return () => {};
}

function subscribeBreakpoint(onStoreChange: () => void) {
  const mqMobile = window.matchMedia("(max-width: 639px)");
  const mqTablet = window.matchMedia("(max-width: 1023px)");
  const onChange = () => onStoreChange();
  mqMobile.addEventListener("change", onChange);
  mqTablet.addEventListener("change", onChange);
  window.addEventListener("orientationchange", onChange);
  return () => {
    mqMobile.removeEventListener("change", onChange);
    mqTablet.removeEventListener("change", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
}

export type GlobalWatermarkProps = {
  userId: string;
  displayName: string;
  email: string;
  /** Server Date.now() at SSR — initial calibration baseline. */
  serverNowMs: number;
};

/**
 * Full-viewport security watermark for authenticated CRM dashboard only.
 * Mounted once from `(dashboard)/layout`; portals to document.body so
 * Dialog/Drawer overlays remain covered without intercepting pointer events.
 */
export function GlobalWatermark({
  userId,
  displayName,
  email,
  serverNowMs,
}: GlobalWatermarkProps) {
  const { t } = useTranslation();
  const reactId = useId().replace(/:/g, "");
  const patternId = `crm-wm-${reactId}`;
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const breakpoint = useSyncExternalStore(
    subscribeBreakpoint,
    readBreakpoint,
    () => "desktop" as Breakpoint,
  );

  const timeDesktopRef = useRef<SVGTSpanElement | null>(null);
  const timeMobileRef = useRef<SVGTextElement | null>(null);
  const clockRef = useRef(createWatermarkClock(serverNowMs));

  const confidential = t("security.watermarkConfidential");
  const identityRaw = buildWatermarkIdentityLine(displayName, email);
  const { offsetX, offsetY } = useMemo(
    () => watermarkOffsetFromSeed(userId || email),
    [userId, email],
  );

  const tile = TILE_BY_BREAKPOINT[breakpoint];
  const isCompact = breakpoint === "mobile";
  const initialTimeLabel = formatHongKongDateTimeSeconds(serverNowMs);
  const fitted = useMemo(() => {
    if (isCompact) {
      return fitWatermarkIdentity(
        identityRaw,
        tile.identityMaxWidth,
        tile.identityBase,
        tile.identityMin,
      );
    }
    // Fit identity+time as one line so short emails are not over-truncated.
    const desktop = fitWatermarkDesktopFirstLine(
      identityRaw,
      initialTimeLabel,
      tile.identityMaxWidth,
      tile.identityBase,
      tile.identityMin,
    );
    return { text: desktop.identityText, fontSize: desktop.fontSize };
  }, [identityRaw, tile, isCompact, initialTimeLabel]);

  useEffect(() => {
    clockRef.current.calibrate(serverNowMs);
  }, [serverNowMs]);

  useEffect(() => {
    const clock = clockRef.current;
    const abort = new AbortController();
    let recalibrateInFlight = false;

    const paintTime = () => {
      const label = formatHongKongDateTimeSeconds(clock.nowMs());
      if (timeDesktopRef.current) timeDesktopRef.current.textContent = label;
      if (timeMobileRef.current) timeMobileRef.current.textContent = label;
    };

    paintTime();
    const tickId = window.setInterval(paintTime, 1000);

    const recalibrate = async () => {
      if (recalibrateInFlight || abort.signal.aborted) return;
      recalibrateInFlight = true;
      try {
        const remote = await fetchSystemTimeMs(abort.signal);
        if (abort.signal.aborted) return;
        if (remote != null) {
          clock.calibrate(remote);
          paintTime();
        }
      } finally {
        recalibrateInFlight = false;
      }
    };

    const recalibrateId = window.setInterval(() => {
      void recalibrate();
    }, WATERMARK_RECALIBRATE_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void recalibrate();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      abort.abort();
      window.clearInterval(tickId);
      window.clearInterval(recalibrateId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, email]);

  useLayoutEffect(() => {
    if (!mounted) return;
    const label = formatHongKongDateTimeSeconds(clockRef.current.nowMs());
    if (timeDesktopRef.current) timeDesktopRef.current.textContent = label;
    if (timeMobileRef.current) timeMobileRef.current.textContent = label;
  }, [mounted, breakpoint, fitted.text, confidential]);

  if (!mounted) return null;

  // Pattern content is drawn rotated; keep origin near tile center.
  const cx = tile.width / 2;
  const cy = tile.height / 2;
  const textStyle: CSSProperties = {
    fontWeight: 500,
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  };

  const layer = (
    <div
      className="crm-security-watermark"
      aria-hidden="true"
      role="presentation"
    >
      <svg
        className="crm-security-watermark__svg"
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
      >
        <defs>
          <pattern
            id={patternId}
            patternUnits="userSpaceOnUse"
            width={tile.width}
            height={tile.height}
            patternTransform={`translate(${offsetX} ${offsetY})`}
          >
            <g transform={`translate(${cx} ${cy}) rotate(-23)`}>
              {isCompact ? (
                <>
                  <text
                    textAnchor="middle"
                    y={-18}
                    fill="currentColor"
                    style={{ ...textStyle, fontSize: `${fitted.fontSize}px` }}
                  >
                    {fitted.text}
                  </text>
                  <text
                    ref={timeMobileRef}
                    textAnchor="middle"
                    y={2}
                    fill="currentColor"
                    style={{ ...textStyle, fontSize: `${tile.secondary}px` }}
                  >
                    {initialTimeLabel}
                  </text>
                  <text
                    textAnchor="middle"
                    y={22}
                    fill="currentColor"
                    style={{ ...textStyle, fontSize: `${tile.secondary}px` }}
                  >
                    {confidential}
                  </text>
                </>
              ) : (
                <>
                  <text
                    textAnchor="middle"
                    y={-8}
                    fill="currentColor"
                    style={{ ...textStyle, fontSize: `${fitted.fontSize}px` }}
                  >
                    <tspan>{fitted.text} · </tspan>
                    <tspan ref={timeDesktopRef}>{initialTimeLabel}</tspan>
                  </text>
                  <text
                    textAnchor="middle"
                    y={14}
                    fill="currentColor"
                    style={{ ...textStyle, fontSize: `${tile.secondary}px` }}
                  >
                    {confidential}
                  </text>
                </>
              )}
            </g>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );

  return createPortal(layer, document.body);
}
