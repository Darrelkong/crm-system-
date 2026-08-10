export type CrmStartupTimingSnapshot = {
  navigationStartMs: number | null;
  responseStartMs: number | null;
  responseEndMs: number | null;
  domContentLoadedMs: number | null;
  windowLoadMs: number | null;
  bootShellVisibleMs: number | null;
  bootShellDismissedMs: number | null;
  reactHydratedMs: number | null;
};

export type CrmStartupTimingMarkName =
  | "bootShellVisible"
  | "domContentLoaded"
  | "windowLoad"
  | "reactHydrated"
  | "bootShellDismissed";

const TIMING_FIELDS: Array<keyof CrmStartupTimingSnapshot> = [
  "navigationStartMs",
  "responseStartMs",
  "responseEndMs",
  "domContentLoadedMs",
  "windowLoadMs",
  "bootShellVisibleMs",
  "bootShellDismissedMs",
  "reactHydratedMs",
];

export function createEmptyStartupTimingSnapshot(): CrmStartupTimingSnapshot {
  return {
    navigationStartMs: null,
    responseStartMs: null,
    responseEndMs: null,
    domContentLoadedMs: null,
    windowLoadMs: null,
    bootShellVisibleMs: null,
    bootShellDismissedMs: null,
    reactHydratedMs: null,
  };
}

export function relativeMs(
  originMs: number,
  eventMs: number | null | undefined,
): number | null {
  if (eventMs == null || Number.isNaN(eventMs)) {
    return null;
  }
  return Math.max(0, Math.round(eventMs - originMs));
}

export function collectNavigationTiming(
  navigationEntry: PerformanceNavigationTiming | undefined,
  originMs: number,
): Pick<
  CrmStartupTimingSnapshot,
  "responseStartMs" | "responseEndMs" | "domContentLoadedMs" | "windowLoadMs"
> {
  if (!navigationEntry) {
    return {
      responseStartMs: null,
      responseEndMs: null,
      domContentLoadedMs: null,
      windowLoadMs: null,
    };
  }

  return {
    responseStartMs: relativeMs(originMs, navigationEntry.responseStart),
    responseEndMs: relativeMs(originMs, navigationEntry.responseEnd),
    domContentLoadedMs: relativeMs(
      originMs,
      navigationEntry.domContentLoadedEventEnd,
    ),
    windowLoadMs: relativeMs(originMs, navigationEntry.loadEventEnd),
  };
}

export function formatStartupTimingLines(
  snapshot: CrmStartupTimingSnapshot,
): string[] {
  const labels: Record<keyof CrmStartupTimingSnapshot, string> = {
    navigationStartMs: "Navigation start",
    responseStartMs: "Response start",
    responseEndMs: "Response end",
    domContentLoadedMs: "DOMContentLoaded",
    windowLoadMs: "Window load",
    bootShellVisibleMs: "Boot shell visible",
    reactHydratedMs: "React hydrated",
    bootShellDismissedMs: "Boot splash removed",
  };

  return TIMING_FIELDS.map((field) => {
    const value = snapshot[field];
    const label = labels[field];
    return `${label}: ${value == null ? "n/a" : `${value}ms`}`;
  });
}

export function startupTimingContainsPii(snapshot: CrmStartupTimingSnapshot): boolean {
  const serialized = JSON.stringify(snapshot);
  const blocked = [
    "email",
    "token",
    "session",
    "password",
    "customer",
    "userId",
    "jwt",
  ];
  return blocked.some((needle) => serialized.toLowerCase().includes(needle));
}

export function parseStartupDebugFlag(
  search: string | null | undefined,
): boolean {
  if (!search) {
    return false;
  }
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  return params.get("startupDebug") === "1";
}

export function parseStartupPreviewFlag(
  search: string | null | undefined,
): boolean {
  if (!search) {
    return false;
  }
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  return params.get("startupPreview") === "1";
}

export function shouldActivateStartupPreview(
  previewRequested: boolean,
  allowDevPreview: boolean,
): boolean {
  return allowDevPreview && previewRequested;
}
