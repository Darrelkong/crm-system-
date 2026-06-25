import { getPostLogoutRedirectPath } from "@/lib/auth/logout-redirect";

export const CRM_LAST_ACTIVITY_KEY = "crm_last_activity_at";

export const CRM_SESSION_BC = "crm_session_sync";

export type SecurityLogoutReason = "manual" | "idle";
export type SessionEndReason = "idle" | "revoked" | "invalid";

export const SESSION_END_REDIRECT_DELAY_MS = 2500;

export function parseSessionEndReason(errorCode?: string): SessionEndReason | null {
  switch (errorCode) {
    case "SESSION_IDLE_EXPIRED":
      return "idle";
    case "SESSION_REVOKED":
      return "revoked";
    case "SESSION_INVALID":
      return "invalid";
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
  }
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
