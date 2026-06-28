import { CLOUDFLARE_ACCESS_LOGOUT_PATH } from "@/lib/auth/logout-redirect";

export const TIMEOUT_LOGIN_VISITS_KEY = "crm_timeout_login_visits";
export const TIMEOUT_ACCESS_LOGOUT_VISIT_THRESHOLD = 3;

export function isTimeoutLoginReason(
  reason: string | null,
  sessionEnd: string | null,
): boolean {
  return reason === "timeout" || sessionEnd === "idle";
}

export function shouldForceAccessLogoutAfterTimeoutVisit(
  visitCount: number,
  isLocalDev: boolean,
): boolean {
  if (isLocalDev) {
    return false;
  }
  return visitCount >= TIMEOUT_ACCESS_LOGOUT_VISIT_THRESHOLD;
}

export function readTimeoutLoginVisitCount(): number {
  if (typeof window === "undefined") {
    return 0;
  }
  try {
    const raw = sessionStorage.getItem(TIMEOUT_LOGIN_VISITS_KEY);
    if (!raw) {
      return 0;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function recordTimeoutLoginVisit(): number {
  const nextCount = readTimeoutLoginVisitCount() + 1;
  try {
    sessionStorage.setItem(TIMEOUT_LOGIN_VISITS_KEY, String(nextCount));
  } catch {
    // ignore storage failures
  }
  return nextCount;
}

export function clearTimeoutLoginVisits(): void {
  try {
    sessionStorage.removeItem(TIMEOUT_LOGIN_VISITS_KEY);
  } catch {
    // ignore storage failures
  }
}

export function redirectToCloudflareAccessLogout(): void {
  window.location.assign(CLOUDFLARE_ACCESS_LOGOUT_PATH);
}
