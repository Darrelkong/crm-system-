/**
 * Work Items-only safe returnTo allowlist.
 * Mirrors Follow-ups Round B security rules without changing Follow-ups.
 */

export const WORK_ITEMS_SAFE_RETURN_MAX_LENGTH = 2000;
export const WORK_ITEMS_PATH = "/work-items";

const PARSE_ORIGIN = "https://crm.invalid";

const ALLOWED_TABS = new Set(["tasks", "notifications"]);
const ALLOWED_TASK_VIEWS = new Set(["open", "today", "overdue", "completed"]);
const ALLOWED_NOTIFICATION_VIEWS = new Set(["unread", "all"]);

function containsForbiddenRawChars(value: string): boolean {
  return /[\u0000\r\n\\]/.test(value);
}

function looksProtocolRelative(value: string): boolean {
  return value.startsWith("//") || /^\\\/\\\//.test(value);
}

function decodeUntilStable(value: string, maxRounds = 3): string | null {
  let current = value;
  for (let i = 0; i < maxRounds; i += 1) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) return current;
      current = next;
    } catch {
      return null;
    }
  }
  return current;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function sanitizeWorkItemsSearch(searchParams: URLSearchParams): string {
  const tabRaw = searchParams.get("tab");
  const tab = tabRaw === "notifications" ? "notifications" : "tasks";
  const viewRaw = searchParams.get("view");
  let view = "open";
  if (tab === "notifications") {
    view =
      viewRaw && ALLOWED_NOTIFICATION_VIEWS.has(viewRaw) ? viewRaw : "all";
  } else {
    view = viewRaw && ALLOWED_TASK_VIEWS.has(viewRaw) ? viewRaw : "open";
  }

  const next = new URLSearchParams();
  next.set("tab", tab);
  next.set("view", view);

  if (tab === "tasks") {
    const staff = searchParams.get("staff")?.trim();
    if (staff && isUuidLike(staff)) {
      next.set("staff", staff);
    }
  }

  const qs = next.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Normalize a candidate Work Items path (pathname + search, no origin/hash).
 * Returns null when unsafe or not /work-items.
 */
export function parseSafeWorkItemsReturnTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (containsForbiddenRawChars(value)) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > WORK_ITEMS_SAFE_RETURN_MAX_LENGTH) return null;
  if (looksProtocolRelative(trimmed)) return null;

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("http:") ||
    lower.startsWith("https:") ||
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    return null;
  }

  const decoded = decodeUntilStable(trimmed);
  if (decoded === null) return null;
  if (decoded.length > WORK_ITEMS_SAFE_RETURN_MAX_LENGTH) return null;
  if (containsForbiddenRawChars(decoded)) return null;
  if (looksProtocolRelative(decoded)) return null;

  const decodedLower = decoded.toLowerCase();
  if (
    decodedLower.startsWith("http:") ||
    decodedLower.startsWith("https:") ||
    decodedLower.startsWith("javascript:") ||
    decodedLower.startsWith("data:") ||
    decodedLower.startsWith("vbscript:")
  ) {
    return null;
  }

  if (!decoded.startsWith("/") || decoded.startsWith("//")) return null;
  if (decoded.includes("\\")) return null;

  let url: URL;
  try {
    url = new URL(decoded, PARSE_ORIGIN);
  } catch {
    return null;
  }

  if (url.origin !== PARSE_ORIGIN) return null;
  if (url.username || url.password) return null;

  let pathname = url.pathname;
  if (pathname === `${WORK_ITEMS_PATH}/`) pathname = WORK_ITEMS_PATH;
  if (pathname !== WORK_ITEMS_PATH) return null;

  // Drop unknown params; keep only allowlisted tab/view/staff.
  const tab = url.searchParams.get("tab");
  if (tab != null && !ALLOWED_TABS.has(tab)) {
    // Invalid tab → still safe path with sanitized defaults.
  }

  const search = sanitizeWorkItemsSearch(url.searchParams);
  return `${WORK_ITEMS_PATH}${search}`;
}

export function buildWorkItemsReturnTo(pathnameAndSearch: string): string | null {
  return parseSafeWorkItemsReturnTo(pathnameAndSearch);
}

export function appendWorkItemsReturnTo(
  customerHref: string,
  returnPath: string,
): string {
  const safe = parseSafeWorkItemsReturnTo(returnPath);
  if (!safe) return customerHref;
  if (!customerHref.startsWith("/customers/")) return customerHref;

  try {
    const url = new URL(customerHref, PARSE_ORIGIN);
    if (url.origin !== PARSE_ORIGIN) return customerHref;
    if (!url.pathname.startsWith("/customers/")) return customerHref;
    url.searchParams.set("returnTo", safe);
    return `${url.pathname}${url.search}`;
  } catch {
    return customerHref;
  }
}
