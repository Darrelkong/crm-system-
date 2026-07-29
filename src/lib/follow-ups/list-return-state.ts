/**
 * Client-only return scroll state for /follow-ups (Browser Back).
 * Does not store customer PII or list payloads.
 */

export const FOLLOW_UPS_RETURN_STATE_VERSION = 1 as const;
export const FOLLOW_UPS_RETURN_TTL_MS = 30 * 60 * 1000;
export const FOLLOW_UPS_RETURN_HISTORY_MARKER_KEY = "__crmFollowUpsReturnKey";
export const FOLLOW_UPS_RETURN_ITEM_ATTR = "data-follow-up-return-id";

export type FollowUpsReturnState = {
  v: typeof FOLLOW_UPS_RETURN_STATE_VERSION;
  url: string;
  scrollY: number;
  itemId?: string;
  itemViewportOffset?: number;
  /** One-time nonce for in-page Link return (not Browser Back). */
  linkNonce?: string;
  savedAt: number;
};

type HistoryStateRecord = Record<string, unknown>;

function canUseSessionStorage(): boolean {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return false;
    const probe = "__crm_fu_probe__";
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** Normalize to pathname + search (no hash). */
export function normalizeFollowUpsListUrl(
  pathname: string,
  search: string,
): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const qs = search.startsWith("?")
    ? search
    : search
      ? `?${search}`
      : "";
  return `${path}${qs}`;
}

export function getCurrentFollowUpsListUrl(): string {
  if (typeof window === "undefined") return "/follow-ups";
  return normalizeFollowUpsListUrl(
    window.location.pathname,
    window.location.search,
  );
}

export function buildFollowUpsReturnStorageKey(url: string): string {
  return `crm:follow-ups:return:v1:${encodeURIComponent(url)}`;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function clampScrollY(scrollY: number, maxScrollY: number): number {
  if (!isFiniteNumber(scrollY)) return 0;
  if (!isFiniteNumber(maxScrollY) || maxScrollY <= 0) return 0;
  return Math.min(Math.max(0, scrollY), maxScrollY);
}

export function getMaxWindowScrollY(): number {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return 0;
  }
  const doc = document.documentElement;
  const body = document.body;
  const scrollHeight = Math.max(
    doc?.scrollHeight ?? 0,
    body?.scrollHeight ?? 0,
  );
  return Math.max(0, scrollHeight - window.innerHeight);
}

export function isFollowUpsReturnStateExpired(
  state: FollowUpsReturnState,
  now = Date.now(),
): boolean {
  if (!isFiniteNumber(state.savedAt)) return true;
  return now - state.savedAt > FOLLOW_UPS_RETURN_TTL_MS;
}

export function validateFollowUpsReturnState(
  raw: unknown,
  expectedUrl: string,
  now = Date.now(),
): FollowUpsReturnState | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.v !== FOLLOW_UPS_RETURN_STATE_VERSION) return null;
  if (typeof candidate.url !== "string" || candidate.url !== expectedUrl) {
    return null;
  }
  if (!isFiniteNumber(candidate.scrollY) || candidate.scrollY < 0) return null;
  if (!isFiniteNumber(candidate.savedAt)) return null;

  const state: FollowUpsReturnState = {
    v: FOLLOW_UPS_RETURN_STATE_VERSION,
    url: candidate.url,
    scrollY: candidate.scrollY,
    savedAt: candidate.savedAt,
  };

  if (typeof candidate.itemId === "string" && candidate.itemId.length > 0) {
    state.itemId = candidate.itemId.slice(0, 128);
  }
  if (isFiniteNumber(candidate.itemViewportOffset)) {
    state.itemViewportOffset = candidate.itemViewportOffset;
  }
  if (
    typeof candidate.linkNonce === "string" &&
    /^[a-zA-Z0-9_-]{1,64}$/.test(candidate.linkNonce)
  ) {
    state.linkNonce = candidate.linkNonce;
  }

  if (isFollowUpsReturnStateExpired(state, now)) return null;
  return state;
}

export function saveFollowUpsReturnState(state: FollowUpsReturnState): boolean {
  try {
    if (!canUseSessionStorage()) return false;
    if (
      !validateFollowUpsReturnState(state, state.url, state.savedAt)
    ) {
      return false;
    }
    const key = buildFollowUpsReturnStorageKey(state.url);
    window.sessionStorage.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function readFollowUpsReturnState(
  expectedUrl: string,
  now = Date.now(),
): FollowUpsReturnState | null {
  try {
    if (!canUseSessionStorage()) return null;
    const key = buildFollowUpsReturnStorageKey(expectedUrl);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      window.sessionStorage.removeItem(key);
      return null;
    }
    const valid = validateFollowUpsReturnState(parsed, expectedUrl, now);
    if (!valid) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return valid;
  } catch {
    return null;
  }
}

export function removeFollowUpsReturnState(url: string): void {
  try {
    if (!canUseSessionStorage()) return;
    window.sessionStorage.removeItem(buildFollowUpsReturnStorageKey(url));
  } catch {
    // ignore
  }
}

function asHistoryRecord(state: unknown): HistoryStateRecord {
  if (state && typeof state === "object" && !Array.isArray(state)) {
    return { ...(state as HistoryStateRecord) };
  }
  return {};
}

export function mergeHistoryStateWithReturnMarker(
  existing: unknown,
  storageKey: string,
): HistoryStateRecord {
  const next = asHistoryRecord(existing);
  next[FOLLOW_UPS_RETURN_HISTORY_MARKER_KEY] = storageKey;
  return next;
}

export function stripReturnMarkerFromHistoryState(
  existing: unknown,
): HistoryStateRecord | null {
  if (existing == null) return null;
  if (typeof existing !== "object" || Array.isArray(existing)) {
    return existing as HistoryStateRecord;
  }
  const next = { ...(existing as HistoryStateRecord) };
  delete next[FOLLOW_UPS_RETURN_HISTORY_MARKER_KEY];
  return next;
}

export function getReturnMarkerFromHistoryState(
  state: unknown,
): string | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const value = (state as HistoryStateRecord)[FOLLOW_UPS_RETURN_HISTORY_MARKER_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * True for same-tab primary activation (mouse left / keyboard Enter).
 * False for modified clicks, middle click, and prevented defaults.
 */
export function shouldSaveFollowUpsReturnOnNavigationClick(
  event: {
    defaultPrevented: boolean;
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
  anchor?: Pick<HTMLAnchorElement, "target"> | null,
): boolean {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  const target = anchor?.target?.trim().toLowerCase();
  if (target === "_blank") return false;
  return true;
}

export function isDocumentReload(): boolean {
  try {
    const entries = performance.getEntriesByType?.(
      "navigation",
    ) as PerformanceNavigationTiming[] | undefined;
    if (entries?.[0]?.type === "reload") return true;
    const legacy = (
      performance as Performance & {
        navigation?: { type?: number };
      }
    ).navigation;
    // 1 === TYPE_RELOAD
    if (legacy?.type === 1) return true;
  } catch {
    // ignore
  }
  return false;
}

function escapeAttributeSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function findVisibleFollowUpReturnElement(
  itemId: string,
): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const nodes = document.querySelectorAll<HTMLElement>(
    `[${FOLLOW_UPS_RETURN_ITEM_ATTR}="${escapeAttributeSelectorValue(itemId)}"]`,
  );
  for (const node of nodes) {
    if (node.getClientRects().length > 0) return node;
  }
  return null;
}

export function computeFollowUpsRestoreScrollY(
  state: FollowUpsReturnState,
  maxScrollY = getMaxWindowScrollY(),
): number {
  if (state.itemId) {
    const el = findVisibleFollowUpReturnElement(state.itemId);
    if (el && isFiniteNumber(state.itemViewportOffset)) {
      const documentTop = el.getBoundingClientRect().top + window.scrollY;
      return clampScrollY(
        documentTop - state.itemViewportOffset,
        maxScrollY,
      );
    }
  }
  return clampScrollY(state.scrollY, maxScrollY);
}

export function clearFollowUpsReturnMarkerOnHistory(
  historyLike: {
    state: unknown;
    replaceState: (data: unknown, unused: string, url?: string) => void;
  } = typeof window !== "undefined"
    ? window.history
    : {
        state: null,
        replaceState: () => undefined,
      },
  url?: string,
): void {
  try {
    const stripped = stripReturnMarkerFromHistoryState(historyLike.state);
    const href =
      url ??
      (typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "/follow-ups");
    historyLike.replaceState(stripped, "", href);
  } catch {
    // ignore
  }
}
