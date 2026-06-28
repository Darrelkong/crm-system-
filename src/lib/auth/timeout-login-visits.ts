import { CLOUDFLARE_ACCESS_LOGOUT_PATH } from "@/lib/auth/logout-redirect";
import { IDLE_RELOGIN_THRESHOLD } from "@/lib/auth/idle-relogin-cookie";

/** @deprecated Use IDLE_RELOGIN_THRESHOLD from idle-relogin-cookie */
export const TIMEOUT_ACCESS_LOGOUT_VISIT_THRESHOLD = IDLE_RELOGIN_THRESHOLD;

export function isTimeoutLoginReason(
  reason: string | null,
  sessionEnd: string | null,
): boolean {
  return reason === "timeout" || sessionEnd === "idle";
}

export function redirectToCloudflareAccessLogout(): void {
  window.location.assign(CLOUDFLARE_ACCESS_LOGOUT_PATH);
}
