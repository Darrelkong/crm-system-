import { getPostLogoutRedirectPath } from "@/lib/auth/logout-redirect";

export const CRM_LAST_ACTIVITY_KEY = "crm_last_activity_at";

export const CRM_SESSION_BC = "crm_session_sync";

export type SecurityLogoutReason = "manual" | "idle";
export type SessionEndReason =
  | "idle"
  | "revoked"
  | "invalid"
  | "device_revoked"
  | "access_reverify";

export const SESSION_END_REDIRECT_DELAY_MS = 2500;

export const ACCESS_REVERIFY_LOGIN_PATH =
  "/login?session_end=access_reverify" as const;

export function parseSessionEndReason(
  errorCode?: string,
): SessionEndReason | null {
  switch (errorCode) {
    case "SESSION_IDLE_EXPIRED":
      return "idle";
    case "SESSION_REVOKED":
      return "revoked";
    case "SESSION_INVALID":
      return "invalid";
    case "SESSION_DEVICE_REVOKED":
      return "device_revoked";
    case "SESSION_ACCESS_REVERIFY_REQUIRED":
      return "access_reverify";
    default:
      return null;
  }
}

export function sessionEndMessageKey(reason: SessionEndReason): string {
  switch (reason) {
    case "idle":
      return "security.sessionTimedOutReLogin";
    case "revoked":
      return "security.sessionRevokedByOtherDevice";
    case "invalid":
      return "security.sessionInvalidReLogin";
    case "device_revoked":
      return "security.deviceAuthorizationRevoked";
    case "access_reverify":
      return "security.accessReverifyRequired";
  }
}

/** Access reverify skips the timeout modal and redirects immediately. */
export function sessionEndShowsModal(reason: SessionEndReason): boolean {
  return reason !== "access_reverify";
}

export async function clearSessionClientState(
  reason: SecurityLogoutReason | "expired" = "expired",
): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  } catch {
    // Best-effort server-side session cleanup.
  }

  try {
    localStorage.removeItem(CRM_LAST_ACTIVITY_KEY);
  } catch {
    // ignore
  }
}

export function redirectToLoginWithSessionEnd(reason: SessionEndReason): void {
  if (reason === "idle") {
    window.location.href = "/login?reason=timeout";
    return;
  }
  window.location.href = `/login?session_end=${reason}`;
}

export function isLocalDevelopmentClient(): boolean {
  if (process.env.NODE_ENV === "development") {
    return true;
  }
  if (typeof window === "undefined") {
    return false;
  }
  const host = window.location.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1";
}

/**
 * Destination for Access reverify (no timeout query, no idle visit count).
 * Production → Cloudflare Access logout via getPostLogoutRedirectPath().
 * Local development → dedicated login query.
 */
export function getAccessReverifyRedirectPath(
  isLocal: boolean = isLocalDevelopmentClient(),
): string {
  if (isLocal) {
    return ACCESS_REVERIFY_LOGIN_PATH;
  }
  return getPostLogoutRedirectPath();
}

/**
 * Clear CRM client state and navigate for Access reverify.
 * Does not use reason=timeout and does not increment idle-relogin counts.
 */
export async function redirectToAccessReverify(): Promise<void> {
  await clearSessionClientState("expired");
  window.location.href = getAccessReverifyRedirectPath();
}

export async function performSecurityLogout(
  reason: SecurityLogoutReason = "manual",
): Promise<void> {
  await clearSessionClientState(reason);
  window.location.href = getPostLogoutRedirectPath();
}

export function redirectToAccessLogout(): void {
  window.location.href = getPostLogoutRedirectPath();
}

export function readLastActivityMs(): number | null {
  try {
    const raw = localStorage.getItem(CRM_LAST_ACTIVITY_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeLastActivityMs(nowMs = Date.now()): void {
  try {
    localStorage.setItem(CRM_LAST_ACTIVITY_KEY, String(nowMs));
  } catch {
    // ignore
  }
}

export type SessionBroadcastLogoutReason =
  | SessionEndReason
  | "manual";

/**
 * Map a BroadcastChannel logout reason to a SessionEndReason.
 * Returns null for manual (ignore) or unknown values.
 */
export function parseBroadcastLogoutReason(
  reason: string,
): SessionEndReason | null {
  switch (reason) {
    case "idle":
    case "revoked":
    case "invalid":
    case "device_revoked":
    case "access_reverify":
      return reason;
    case "manual":
    default:
      return null;
  }
}

export function shouldInspectSessionApiResponse(url: string): boolean {
  if (!url.includes("/api/")) return false;
  if (url.includes("/api/auth/login")) return false;
  if (url.includes("/api/auth/logout")) return false;
  return true;
}
