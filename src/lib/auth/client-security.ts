import { getPostLogoutRedirectPath } from "@/lib/auth/logout-redirect";

export const CRM_LAST_ACTIVITY_KEY = "crm_last_activity_at";

export const CRM_SESSION_BC = "crm_session_sync";

export type SecurityLogoutReason = "manual" | "idle";

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
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  } catch {
    // Still clear client state and redirect below.
  }

  try {
    localStorage.removeItem(CRM_LAST_ACTIVITY_KEY);
  } catch {
    // ignore
  }

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
