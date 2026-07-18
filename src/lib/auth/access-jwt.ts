import {
  createRemoteJWKSet,
  errors as JoseErrors,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import { ACCESS_LOGIN_WINDOW_MS } from "@/lib/auth/constants";

/** Max allowed clock skew for iat in the future. */
const MAX_FUTURE_IAT_SKEW_MS = 60_000;

export type AccessJwtPayload = {
  iat?: number;
  exp?: number;
  aud?: string | string[];
  iss?: string;
  sub?: string;
  email?: string;
};

export type AccessVerifyFailureReason =
  | "missing"
  | "invalid"
  | "expired"
  | "nbf"
  | "bad_issuer"
  | "bad_audience"
  | "no_email"
  | "jwks_unavailable"
  | "misconfigured"
  | "future_iat";

export type VerifiedAccessIdentity = {
  email: string;
  iat: number;
  exp: number;
  sub?: string;
};

export type AccessWindowResult =
  | {
      ok: true;
      iat: number;
      exp?: number;
      email?: string;
      skipped: boolean;
    }
  | { ok: false; reason: AccessVerifyFailureReason | "skipped" };

export type AccessJwtVerifyDeps = {
  getKey?: JWTVerifyGetKey;
  teamDomain?: string;
  audience?: string;
  nowMs?: () => number;
};

const remoteJwksByDomain = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

let testVerifyDeps: AccessJwtVerifyDeps | null = null;

/** Test-only: inject JWKS / env overrides. Pass null to clear. */
export function setAccessJwtTestDeps(deps: AccessJwtVerifyDeps | null): void {
  testVerifyDeps = deps;
}

/** Test-only: clear cached RemoteJWKSet instances. */
export function resetAccessJwtJwksCache(): void {
  remoteJwksByDomain.clear();
}

export function normalizeAccessEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Normalize CF_ACCESS_TEAM_DOMAIN to an https origin without trailing slash.
 * Rejects values that already include a JWKS path or non-https schemes.
 */
export function normalizeTeamDomain(
  raw: string | undefined | null,
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.pathname && url.pathname !== "/") return null;
  if (url.search || url.hash) return null;

  return `${url.protocol}//${url.host}`;
}

export function buildAccessJwksUrl(teamDomain: string): string {
  return `${teamDomain}/cdn-cgi/access/certs`;
}

export function getConfiguredSuperAdminEmail(): string | null {
  const raw = process.env.CF_ACCESS_SUPER_ADMIN_EMAIL;
  if (raw == null || raw.trim() === "") return null;
  return normalizeAccessEmail(raw);
}

export function isSuperAdminAccessEmail(verifiedEmail: string): boolean {
  const configured = getConfiguredSuperAdminEmail();
  if (!configured) return false;
  return verifiedEmail === configured;
}

export type AccessEmailBindingResult =
  | { ok: true; crossAccountSuperAdmin: boolean }
  | { ok: false; reason: "access_email_missing" | "access_email_mismatch" };

/**
 * Enforce Access email === CRM login email, with optional super-admin exception.
 * Call only when Access JWT checks are required (not skipped).
 */
export function evaluateAccessLoginEmailBinding(input: {
  verifiedAccessEmail: string | null | undefined;
  loginEmail: string;
}): AccessEmailBindingResult {
  const verified = input.verifiedAccessEmail?.trim()
    ? normalizeAccessEmail(input.verifiedAccessEmail)
    : null;
  const loginEmail = normalizeAccessEmail(input.loginEmail);

  if (!verified) {
    return { ok: false, reason: "access_email_missing" };
  }

  if (verified === loginEmail) {
    return { ok: true, crossAccountSuperAdmin: false };
  }

  if (isSuperAdminAccessEmail(verified)) {
    return { ok: true, crossAccountSuperAdmin: true };
  }

  return { ok: false, reason: "access_email_mismatch" };
}

/**
 * Skip Access JWT checks only for explicit non-production environments.
 * Production never skips via Host headers or SKIP_ACCESS_JWT_CHECK.
 */
export function isAccessJwtCheckSkipped(_headers?: Headers): boolean {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "development" || nodeEnv === "test") {
    return true;
  }
  if (
    process.env.SKIP_ACCESS_JWT_CHECK === "true" &&
    nodeEnv !== "production"
  ) {
    return true;
  }
  return false;
}

/** Production custom domain — require Cloudflare Access before CRM login. */
export function shouldRequireCloudflareAccess(_headers?: Headers): boolean {
  return !isAccessJwtCheckSkipped();
}

function parseCookieValue(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
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

function getRemoteJwks(teamDomain: string) {
  let jwks = remoteJwksByDomain.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(buildAccessJwksUrl(teamDomain)));
    remoteJwksByDomain.set(teamDomain, jwks);
  }
  return jwks;
}

function mapJoseVerifyError(error: unknown): AccessVerifyFailureReason {
  if (error instanceof JoseErrors.JWTExpired) {
    return "expired";
  }
  if (error instanceof JoseErrors.JWTClaimValidationFailed) {
    const claim = (error as { claim?: string }).claim;
    if (claim === "nbf") return "nbf";
    if (claim === "iss") return "bad_issuer";
    if (claim === "aud") return "bad_audience";
    if (claim === "exp") return "expired";
    return "invalid";
  }
  if (error instanceof JoseErrors.JOSEAlgNotAllowed) {
    return "invalid";
  }
  if (error instanceof JoseErrors.JWKSNoMatchingKey) {
    return "invalid";
  }
  if (error instanceof JoseErrors.JWKSTimeout) {
    return "jwks_unavailable";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch|network|ENOTFOUND|ECONNREFUSED|timeout|jwks/i.test(message)) {
    return "jwks_unavailable";
  }
  return "invalid";
}

/**
 * Cryptographically verify a Cloudflare Access JWT (RS256 + iss/aud/exp/nbf).
 * Also enforces CRM Access login window via iat age.
 */
export async function verifyCloudflareAccessJwt(
  token: string,
  deps?: AccessJwtVerifyDeps,
): Promise<
  | { ok: true; identity: VerifiedAccessIdentity }
  | { ok: false; reason: AccessVerifyFailureReason }
> {
  const merged: AccessJwtVerifyDeps = { ...testVerifyDeps, ...deps };
  const teamDomain =
    merged.teamDomain ??
    normalizeTeamDomain(process.env.CF_ACCESS_TEAM_DOMAIN);
  const audienceRaw = merged.audience ?? process.env.CF_ACCESS_AUD;
  const audience = audienceRaw?.trim() || null;

  if (!teamDomain || !audience) {
    return { ok: false, reason: "misconfigured" };
  }

  const getKey = merged.getKey ?? getRemoteJwks(teamDomain);
  const nowMs = merged.nowMs ?? Date.now;

  try {
    const { payload } = await jwtVerify(token, getKey, {
      issuer: teamDomain,
      audience,
      algorithms: ["RS256"],
      clockTolerance: 30,
    });

    if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) {
      return { ok: false, reason: "invalid" };
    }
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      return { ok: false, reason: "invalid" };
    }

    const now = nowMs();
    if (payload.iat * 1000 > now + MAX_FUTURE_IAT_SKEW_MS) {
      return { ok: false, reason: "future_iat" };
    }

    const ageMs = now - payload.iat * 1000;
    if (ageMs > ACCESS_LOGIN_WINDOW_MS) {
      return { ok: false, reason: "expired" };
    }

    const emailRaw = typeof payload.email === "string" ? payload.email : "";
    if (!emailRaw.trim()) {
      return { ok: false, reason: "no_email" };
    }

    return {
      ok: true,
      identity: {
        email: normalizeAccessEmail(emailRaw),
        iat: payload.iat,
        exp: payload.exp,
        sub: typeof payload.sub === "string" ? payload.sub : undefined,
      },
    };
  } catch (error) {
    return { ok: false, reason: mapJoseVerifyError(error) };
  }
}

export async function validateAccessLoginWindow(
  headers: Headers,
): Promise<AccessWindowResult> {
  if (isAccessJwtCheckSkipped(headers)) {
    return {
      ok: true,
      iat: Math.floor(Date.now() / 1000),
      skipped: true,
    };
  }

  const token = getAccessJwtFromHeaders(headers);
  if (!token) {
    return { ok: false, reason: "missing" };
  }

  const verified = await verifyCloudflareAccessJwt(token);
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }

  return {
    ok: true,
    iat: verified.identity.iat,
    exp: verified.identity.exp,
    email: verified.identity.email,
    skipped: false,
  };
}

export async function validateAccessLoginWindowFromRequest(
  request: Request,
): Promise<AccessWindowResult> {
  return validateAccessLoginWindow(request.headers);
}
