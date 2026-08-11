export const NAVIGATION_PERF_MARKER_KEY = "crm-customer-nav-perf-v1";
export const NAVIGATION_PERF_MARKER_VERSION = 1;
export const NAVIGATION_PERF_MAX_AGE_MS = 30_000;

export type NavigationPerfMarker = {
  version: number;
  source: "customer-list";
  pointerDownEpochMs?: number;
  clickEpochMs: number;
  createdAtEpochMs: number;
};

export type RouteResourceState = "after-click" | "before-click" | "not-observed";

export type NavigationPerfMetrics = {
  pointerToClickMs: number | null;
  clickToCommitMs: number;
  routeResourceState: RouteResourceState;
  routeBeforeClickMs: number | null;
  clickToRouteRequestStartMs: number | null;
  routeRequestWaitMs: number | null;
  routeResponseTransferMs: number | null;
  clickToRouteResponseEndMs: number | null;
  routeResponseEndToCommitMs: number | null;
  postClickScriptCount: number;
  clickToLastScriptResponseEndMs: number | null;
  commitToNextFrameMs: number | null;
  commitToSecondFrameMs: number | null;
};

export type ResourceTimingLike = {
  name: string;
  initiatorType: string;
  startTime: number;
  requestStart?: number;
  responseStart?: number;
  responseEnd?: number;
};

const ALLOWED_MARKER_KEYS = new Set([
  "version",
  "source",
  "pointerDownEpochMs",
  "clickEpochMs",
  "createdAtEpochMs",
]);

export function shouldEnableCustomerNavigationPerf(
  role: string,
  perfParam: string | undefined,
): boolean {
  return role === "admin" && perfParam === "1";
}

export function epochNow(): number {
  if (
    typeof performance !== "undefined" &&
    typeof performance.timeOrigin === "number" &&
    typeof performance.now === "function"
  ) {
    return performance.timeOrigin + performance.now();
  }
  return Date.now();
}

function readRawMarker(): NavigationPerfMarker | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }
  const raw = sessionStorage.getItem(NAVIGATION_PERF_MARKER_KEY);
  if (!raw) {
    return null;
  }
  return parseNavigationMarker(raw);
}

export function parseNavigationMarker(raw: string): NavigationPerfMarker | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== NAVIGATION_PERF_MARKER_VERSION) {
      return null;
    }
    if (value.source !== "customer-list") {
      return null;
    }
    if (typeof value.clickEpochMs !== "number") {
      return null;
    }
    if (typeof value.createdAtEpochMs !== "number") {
      return null;
    }
    const marker: NavigationPerfMarker = {
      version: NAVIGATION_PERF_MARKER_VERSION,
      source: "customer-list",
      clickEpochMs: value.clickEpochMs,
      createdAtEpochMs: value.createdAtEpochMs,
    };
    if (typeof value.pointerDownEpochMs === "number") {
      marker.pointerDownEpochMs = value.pointerDownEpochMs;
    }
    return marker;
  } catch {
    return null;
  }
}

export function isNavigationMarkerStale(
  marker: NavigationPerfMarker,
  nowEpochMs: number,
  maxAgeMs = NAVIGATION_PERF_MAX_AGE_MS,
): boolean {
  return nowEpochMs - marker.createdAtEpochMs > maxAgeMs;
}

export function writeNavigationMarker(marker: NavigationPerfMarker): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.setItem(NAVIGATION_PERF_MARKER_KEY, JSON.stringify(marker));
}

export function recordNavigationPointerDownMark(): void {
  const now = epochNow();
  const existing = readRawMarker();
  writeNavigationMarker({
    version: NAVIGATION_PERF_MARKER_VERSION,
    source: "customer-list",
    pointerDownEpochMs: now,
    clickEpochMs: existing?.clickEpochMs ?? now,
    createdAtEpochMs: existing?.createdAtEpochMs ?? now,
  });
}

export function recordNavigationClickMark(): void {
  const now = epochNow();
  const existing = readRawMarker();
  writeNavigationMarker({
    version: NAVIGATION_PERF_MARKER_VERSION,
    source: "customer-list",
    pointerDownEpochMs: existing?.pointerDownEpochMs ?? now,
    clickEpochMs: now,
    createdAtEpochMs: existing?.createdAtEpochMs ?? now,
  });
}

export function consumeNavigationMarker(
  nowEpochMs = epochNow(),
): NavigationPerfMarker | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }
  const raw = sessionStorage.getItem(NAVIGATION_PERF_MARKER_KEY);
  if (!raw) {
    return null;
  }
  sessionStorage.removeItem(NAVIGATION_PERF_MARKER_KEY);
  const marker = parseNavigationMarker(raw);
  if (!marker || isNavigationMarkerStale(marker, nowEpochMs)) {
    return null;
  }
  return marker;
}

export function markerContainsOnlyAllowedFields(raw: string): boolean {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return Object.keys(value).every((key) => ALLOWED_MARKER_KEYS.has(key));
  } catch {
    return false;
  }
}

function resourcePathname(
  entryName: string,
  origin: string,
): string | null {
  try {
    return new URL(entryName, origin).pathname;
  } catch {
    return null;
  }
}

function resourceEpoch(
  timeOrigin: number,
  timingValue: number | undefined,
): number | null {
  if (typeof timingValue !== "number" || timingValue <= 0) {
    return null;
  }
  return timeOrigin + timingValue;
}

function closestRouteCandidate(
  resources: ResourceTimingLike[],
  detailPathname: string,
  clickEpochMs: number,
  timeOrigin: number,
  origin: string,
): ResourceTimingLike | null {
  let best: ResourceTimingLike | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of resources) {
    if (entry.initiatorType !== "fetch") {
      continue;
    }
    const pathname = resourcePathname(entry.name, origin);
    if (pathname !== detailPathname) {
      continue;
    }
    const startEpoch =
      resourceEpoch(timeOrigin, entry.requestStart) ??
      resourceEpoch(timeOrigin, entry.startTime);
    if (startEpoch == null) {
      continue;
    }
    const distance = Math.abs(startEpoch - clickEpochMs);
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }

  return best;
}

export function deriveNavigationPerfMetrics(
  marker: NavigationPerfMarker,
  commitEpochMs: number,
  detailPathname: string,
  resources: ResourceTimingLike[],
  timeOrigin: number,
  origin = "https://example.com",
): NavigationPerfMetrics {
  const clickEpochMs = marker.clickEpochMs;
  const pointerToClickMs =
    typeof marker.pointerDownEpochMs === "number"
      ? clickEpochMs - marker.pointerDownEpochMs
      : null;
  const clickToCommitMs = commitEpochMs - clickEpochMs;

  const routeCandidate = closestRouteCandidate(
    resources,
    detailPathname,
    clickEpochMs,
    timeOrigin,
    origin,
  );

  let routeResourceState: RouteResourceState = "not-observed";
  let routeBeforeClickMs: number | null = null;
  let clickToRouteRequestStartMs: number | null = null;
  let routeRequestWaitMs: number | null = null;
  let routeResponseTransferMs: number | null = null;
  let clickToRouteResponseEndMs: number | null = null;
  let routeResponseEndToCommitMs: number | null = null;

  if (routeCandidate) {
    const requestStartEpoch =
      resourceEpoch(timeOrigin, routeCandidate.requestStart) ??
      resourceEpoch(timeOrigin, routeCandidate.startTime);
    const responseStartEpoch = resourceEpoch(
      timeOrigin,
      routeCandidate.responseStart,
    );
    const responseEndEpoch = resourceEpoch(
      timeOrigin,
      routeCandidate.responseEnd,
    );

    if (responseEndEpoch != null && responseEndEpoch <= clickEpochMs) {
      routeResourceState = "before-click";
      routeBeforeClickMs = clickEpochMs - responseEndEpoch;
    } else if (requestStartEpoch != null && requestStartEpoch >= clickEpochMs) {
      routeResourceState = "after-click";
    } else if (responseEndEpoch != null && responseEndEpoch > clickEpochMs) {
      routeResourceState = "after-click";
    } else if (requestStartEpoch != null) {
      routeResourceState = "after-click";
    }

    if (requestStartEpoch != null) {
      clickToRouteRequestStartMs = requestStartEpoch - clickEpochMs;
    }
    if (requestStartEpoch != null && responseStartEpoch != null) {
      routeRequestWaitMs = responseStartEpoch - requestStartEpoch;
    }
    if (responseStartEpoch != null && responseEndEpoch != null) {
      routeResponseTransferMs = responseEndEpoch - responseStartEpoch;
    }
    if (responseEndEpoch != null) {
      clickToRouteResponseEndMs = responseEndEpoch - clickEpochMs;
      routeResponseEndToCommitMs = commitEpochMs - responseEndEpoch;
    }
  }

  const postClickScripts = resources.filter((entry) => {
    if (entry.initiatorType !== "script") {
      return false;
    }
    const startEpoch = resourceEpoch(timeOrigin, entry.startTime);
    return startEpoch != null && startEpoch >= clickEpochMs;
  });

  let clickToLastScriptResponseEndMs: number | null = null;
  for (const entry of postClickScripts) {
    const responseEndEpoch = resourceEpoch(timeOrigin, entry.responseEnd);
    if (responseEndEpoch == null) {
      continue;
    }
    const delta = responseEndEpoch - clickEpochMs;
    if (
      clickToLastScriptResponseEndMs == null ||
      delta > clickToLastScriptResponseEndMs
    ) {
      clickToLastScriptResponseEndMs = delta;
    }
  }

  return {
    pointerToClickMs,
    clickToCommitMs,
    routeResourceState,
    routeBeforeClickMs,
    clickToRouteRequestStartMs,
    routeRequestWaitMs,
    routeResponseTransferMs,
    clickToRouteResponseEndMs,
    routeResponseEndToCommitMs,
    postClickScriptCount: postClickScripts.length,
    clickToLastScriptResponseEndMs,
    commitToNextFrameMs: null,
    commitToSecondFrameMs: null,
  };
}

export function roundNavigationPerfMs(ms: number): string {
  const rounded = Math.round(ms * 10) / 10;
  return `${rounded} ms`;
}

export function formatNavigationPerfValue(
  value: number | null | undefined,
): string {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }
  return roundNavigationPerfMs(value);
}
