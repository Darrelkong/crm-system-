/**
 * Follow-ups-only safe returnTo allowlist.
 * Rejects open redirects; never trusts a full origin from the client.
 */

export const FOLLOW_UPS_SAFE_RETURN_MAX_LENGTH = 2000;
export const FOLLOW_UPS_LINK_RETURN_PARAM = "crmFuRet";

const PARSE_ORIGIN = "https://crm.invalid";

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

function isSafeFollowUpsPathname(pathname: string): boolean {
  if (pathname === "/follow-ups") return true;
  if (pathname === "/follow-ups/") return true;
  return false;
}

/**
 * Normalize a candidate Follow-ups list path (pathname + search, no origin/hash).
 * Returns null when unsafe or not exactly /follow-ups.
 */
export function parseSafeFollowUpsReturnTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (containsForbiddenRawChars(value)) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > FOLLOW_UPS_SAFE_RETURN_MAX_LENGTH) return null;
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
  if (decoded.length > FOLLOW_UPS_SAFE_RETURN_MAX_LENGTH) return null;
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

  // Relative path only; reject scheme-like or backslash paths.
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
  if (pathname === "/follow-ups/") pathname = "/follow-ups";
  if (!isSafeFollowUpsPathname(pathname)) return null;
  // Exact path only — reject /follow-ups-evil and /follow-ups.evil via URL parser
  // (those become different pathnames).
  if (pathname !== "/follow-ups") return null;

  const search = url.search; // includes leading ? when present
  return `${pathname}${search}`;
}

/** Build a Follow-ups return path from pathname + search (validated). */
export function buildFollowUpsReturnTo(pathnameAndSearch: string): string | null {
  return parseSafeFollowUpsReturnTo(pathnameAndSearch);
}

/**
 * Append ?returnTo=… to a customer detail href using a validated Follow-ups path.
 * Returns the original customerHref when returnPath is unsafe.
 */
export function appendFollowUpsReturnTo(
  customerHref: string,
  returnPath: string,
): string {
  const safe = parseSafeFollowUpsReturnTo(returnPath);
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

export function createFollowUpsLinkReturnNonce(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    }
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Attach one-time link-return nonce without altering filter semantics. */
export function withFollowUpsLinkReturnNonce(
  followUpsPath: string,
  nonce: string,
): string | null {
  const safe = parseSafeFollowUpsReturnTo(followUpsPath);
  if (!safe) return null;
  const trimmedNonce = nonce.trim();
  if (!trimmedNonce || trimmedNonce.length > 64) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmedNonce)) return null;

  try {
    const url = new URL(safe, PARSE_ORIGIN);
    url.searchParams.set(FOLLOW_UPS_LINK_RETURN_PARAM, trimmedNonce);
    return parseSafeFollowUpsReturnTo(`${url.pathname}${url.search}`);
  } catch {
    return null;
  }
}

export function stripFollowUpsLinkReturnNonce(followUpsPath: string): string {
  const safe = parseSafeFollowUpsReturnTo(followUpsPath);
  if (!safe) return followUpsPath;
  try {
    const url = new URL(safe, PARSE_ORIGIN);
    if (!url.searchParams.has(FOLLOW_UPS_LINK_RETURN_PARAM)) return safe;
    url.searchParams.delete(FOLLOW_UPS_LINK_RETURN_PARAM);
    const qs = url.searchParams.toString();
    return qs ? `${url.pathname}?${qs}` : url.pathname;
  } catch {
    return safe;
  }
}

export function getFollowUpsLinkReturnNonce(
  followUpsPath: string,
): string | null {
  const safe = parseSafeFollowUpsReturnTo(followUpsPath);
  if (!safe) return null;
  try {
    const url = new URL(safe, PARSE_ORIGIN);
    const nonce = url.searchParams.get(FOLLOW_UPS_LINK_RETURN_PARAM);
    if (!nonce || !/^[a-zA-Z0-9_-]+$/.test(nonce)) return null;
    return nonce;
  } catch {
    return null;
  }
}
