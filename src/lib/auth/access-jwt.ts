import { ACCESS_LOGIN_WINDOW_MS } from "@/lib/auth/constants";

export type AccessJwtPayload = {
  iat?: number;
  exp?: number;
  aud?: string | string[];
  iss?: string;
  sub?: string;
  email?: string;
};

export type AccessWindowResult =
  | { ok: true; iat: number; exp?: number }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "skipped" };

function parseCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

export function isLocalDevelopmentHost(host: string): boolean {
  const hostname = host.split(":")[0]?.trim().toLowerCase() ?? "";
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function getHostFromHeaders(headers: Headers): string {
  return (
    headers.get("x-forwarded-host") ??
    headers.get("host") ??
    ""
  );
}

/** Skip Cloudflare Access JWT checks on local dev (no Access in front of the app). */
export function isAccessJwtCheckSkipped(headers?: Headers): boolean {
  if (process.env.NODE_ENV === "development") {
    return true;
  }
  if (process.env.SKIP_ACCESS_JWT_CHECK === "true") {
    return true;
  }
  if (headers) {
    const host = getHostFromHeaders(headers);
    if (host && isLocalDevelopmentHost(host)) {
      return true;
    }
  }
  return false;
}

/** Production custom domain — require Cloudflare Access before CRM login. */
export function shouldRequireCloudflareAccess(headers?: Headers): boolean {
  return !isAccessJwtCheckSkipped(headers);
}

export function getAccessJwtFromHeaders(headers: Headers): string | null {
  const fromHeader =
    headers.get("Cf-Access-Jwt-Assertion") ??
    headers.get("CF-Access-JWT-Assertion");
  if (fromHeader) {
    return fromHeader;
  }
  return parseCookieValue(headers.get("cookie"), "CF_Authorization");
}

export function getAccessJwtFromRequest(request: Request): string | null {
  return getAccessJwtFromHeaders(request.headers);
}

export function decodeAccessJwtPayload(token: string): AccessJwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }
    const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(payloadJson) as AccessJwtPayload;
  } catch {
    return null;
  }
}

export function validateAccessLoginWindow(
  headers: Headers,
): AccessWindowResult {
  if (isAccessJwtCheckSkipped(headers)) {
    return { ok: true, iat: Math.floor(Date.now() / 1000) };
  }

  const token = getAccessJwtFromHeaders(headers);
  if (!token) {
    return { ok: false, reason: "missing" };
  }

  const payload = decodeAccessJwtPayload(token);
  if (!payload?.iat) {
    return { ok: false, reason: "invalid" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp != null && payload.exp <= nowSec) {
    return { ok: false, reason: "expired" };
  }

  const ageMs = Date.now() - payload.iat * 1000;
  if (ageMs > ACCESS_LOGIN_WINDOW_MS) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, iat: payload.iat, exp: payload.exp };
}

export function validateAccessLoginWindowFromRequest(
  request: Request,
): AccessWindowResult {
  return validateAccessLoginWindow(request.headers);
}
