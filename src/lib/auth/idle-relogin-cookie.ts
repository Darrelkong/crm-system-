import type { NextRequest, NextResponse } from "next/server";
import {
  getAccessJwtFromHeaders,
  isAccessJwtCheckSkipped,
  validateAccessLoginWindow,
  validateAccessLoginWindowFromRequest,
  verifyCloudflareAccessJwt,
} from "@/lib/auth/access-jwt";

export const IDLE_RELOGIN_COUNT_COOKIE = "crm_idle_relogin_count";
export const ACCESS_IAT_MARKER_COOKIE = "crm_access_iat_marker";
/** After the third idle logout within the same Access cycle, CRM login requires Access reverify. */
export const IDLE_RELOGIN_THRESHOLD = 3;

const COOKIE_MAX_AGE_SEC = 7 * 24 * 60 * 60;

export type IdleReloginCookieUpdate = {
  count: number;
  accessIatMarker: number;
};

export type IdleReloginState = {
  count: number;
  requiresAccessReverify: boolean;
  cookieUpdate: IdleReloginCookieUpdate | null;
};

type CookieReader = {
  get: (name: string) => { value: string } | undefined;
};

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getIdleReloginCookieOptions(maxAge = COOKIE_MAX_AGE_SEC) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function parseIdleReloginCount(raw: string | undefined): number {
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function parseAccessIatMarker(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function readIdleReloginCookies(
  reader: CookieReader,
): { count: number; accessIatMarker: number | null } {
  return {
    count: parseIdleReloginCount(reader.get(IDLE_RELOGIN_COUNT_COOKIE)?.value),
    accessIatMarker: parseAccessIatMarker(
      reader.get(ACCESS_IAT_MARKER_COOKIE)?.value,
    ),
  };
}

/**
 * Returns Access JWT iat only after cryptographic verification.
 * Unsigned / invalid tokens yield null (fail closed for marker use).
 */
export async function getAccessIatFromHeaders(
  headers: Headers,
): Promise<number | null> {
  if (isAccessJwtCheckSkipped(headers)) {
    return Math.floor(Date.now() / 1000);
  }
  const token = getAccessJwtFromHeaders(headers);
  if (!token) return null;
  const verified = await verifyCloudflareAccessJwt(token);
  if (!verified.ok) return null;
  return verified.identity.iat;
}

/**
 * Pure idle-relogin state from stored cookies and the current Access JWT iat.
 * Resets count when Access iat advances (new Access verification cycle).
 */
export function computeIdleReloginState(
  accessIat: number,
  storedCount: number,
  storedMarker: number | null,
  skipAccessReverify = false,
): IdleReloginState {
  if (storedMarker !== null && accessIat > storedMarker) {
    return {
      count: 0,
      requiresAccessReverify: false,
      cookieUpdate: { count: 0, accessIatMarker: accessIat },
    };
  }

  const needsMarkerInit = storedMarker === null;

  return {
    count: storedCount,
    requiresAccessReverify:
      !skipAccessReverify && storedCount >= IDLE_RELOGIN_THRESHOLD,
    cookieUpdate: needsMarkerInit
      ? { count: storedCount, accessIatMarker: accessIat }
      : null,
  };
}

export function computeIncrementedIdleRelogin(
  currentCount: number,
  accessIat: number | null,
  storedMarker: number | null,
): IdleReloginCookieUpdate {
  const nextCount = currentCount + 1;
  const marker = storedMarker ?? accessIat ?? 0;
  return { count: nextCount, accessIatMarker: marker };
}

export function applyIdleReloginCookieUpdateToResponse(
  response: NextResponse,
  update: IdleReloginCookieUpdate,
): void {
  const options = getIdleReloginCookieOptions();
  response.cookies.set(IDLE_RELOGIN_COUNT_COOKIE, String(update.count), options);
  response.cookies.set(
    ACCESS_IAT_MARKER_COOKIE,
    String(update.accessIatMarker),
    options,
  );
}

type NextCookieStore = {
  set: (options: {
    name: string;
    value: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
    path?: string;
    maxAge?: number;
  }) => void;
};

export function applyIdleReloginCookieUpdateToStore(
  cookieStore: NextCookieStore,
  update: IdleReloginCookieUpdate,
): void {
  const options = getIdleReloginCookieOptions();
  cookieStore.set({
    ...options,
    name: IDLE_RELOGIN_COUNT_COOKIE,
    value: String(update.count),
  });
  cookieStore.set({
    ...options,
    name: ACCESS_IAT_MARKER_COOKIE,
    value: String(update.accessIatMarker),
  });
}

export async function incrementIdleReloginOnResponse(
  request: NextRequest,
  response: NextResponse,
): Promise<void> {
  const stored = readIdleReloginCookies(request.cookies);
  const accessIat = await getAccessIatFromHeaders(request.headers);
  const update = computeIncrementedIdleRelogin(
    stored.count,
    accessIat,
    stored.accessIatMarker,
  );
  applyIdleReloginCookieUpdateToResponse(response, update);
}

/** Sync marker init / iat reset on /login without incrementing idle count. */
export async function syncIdleReloginCookiesOnLoginVisit(
  request: NextRequest,
  response: NextResponse,
): Promise<void> {
  const state = await resolveIdleReloginStateFromNextRequest(request);
  if (state.cookieUpdate) {
    applyIdleReloginCookieUpdateToResponse(response, state.cookieUpdate);
  }
}

export async function resolveIdleReloginState(
  headers: Headers,
  reader: CookieReader,
): Promise<IdleReloginState & { accessCheckSkipped: boolean }> {
  if (isAccessJwtCheckSkipped(headers)) {
    return {
      count: 0,
      requiresAccessReverify: false,
      cookieUpdate: null,
      accessCheckSkipped: true,
    };
  }

  const accessWindow = await validateAccessLoginWindow(headers);
  if (!accessWindow.ok) {
    return {
      count: readIdleReloginCookies(reader).count,
      requiresAccessReverify: false,
      cookieUpdate: null,
      accessCheckSkipped: false,
    };
  }

  const stored = readIdleReloginCookies(reader);
  const state = computeIdleReloginState(
    accessWindow.iat,
    stored.count,
    stored.accessIatMarker,
    false,
  );

  return { ...state, accessCheckSkipped: false };
}

function createCookieReaderFromHeader(cookieHeader: string | null): CookieReader {
  return {
    get: (name: string) => {
      if (!cookieHeader) return undefined;
      for (const part of cookieHeader.split(";")) {
        const [rawKey, ...rest] = part.trim().split("=");
        if (rawKey === name) {
          return { value: decodeURIComponent(rest.join("=")) };
        }
      }
      return undefined;
    },
  };
}

export function readIdleReloginCookiesFromRequest(
  request: Pick<Request, "headers">,
): { count: number; accessIatMarker: number | null } {
  return readIdleReloginCookies(
    createCookieReaderFromHeader(request.headers.get("cookie")),
  );
}

export async function resolveIdleReloginStateFromRequest(
  request: Pick<Request, "headers">,
): Promise<IdleReloginState & { accessCheckSkipped: boolean }> {
  return resolveIdleReloginState(
    request.headers,
    createCookieReaderFromHeader(request.headers.get("cookie")),
  );
}

export async function resolveIdleReloginStateFromNextRequest(
  request: NextRequest,
): Promise<IdleReloginState & { accessCheckSkipped: boolean }> {
  return resolveIdleReloginState(request.headers, request.cookies);
}

export async function incrementIdleReloginForRequest(
  request: Pick<Request, "headers">,
): Promise<IdleReloginCookieUpdate> {
  const stored = readIdleReloginCookiesFromRequest(request);
  const accessIat = await getAccessIatFromHeaders(request.headers);
  return computeIncrementedIdleRelogin(
    stored.count,
    accessIat,
    stored.accessIatMarker,
  );
}

export async function isAccessLoginWindowValid(
  request: Request,
): Promise<boolean> {
  if (isAccessJwtCheckSkipped(request.headers)) {
    return true;
  }
  return (await validateAccessLoginWindowFromRequest(request)).ok;
}
