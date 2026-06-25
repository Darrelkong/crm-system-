export const SESSION_COOKIE_NAME = "crm_session";

/** 7 days — absolute session ceiling; idle timeout revokes earlier */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** After Cloudflare Access, CRM login must complete within this window */
export const ACCESS_LOGIN_WINDOW_MS = 5 * 60 * 1000;

/** Cloudflare Access logout — clears Access session cookie */
export const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";

/** Throttle session last_activity writes (ms) */
export const SESSION_ACTIVITY_TOUCH_INTERVAL_MS = 30 * 1000;

export const AUTH_ERROR_CODES = {
  ACCESS_VERIFICATION_EXPIRED: "ACCESS_VERIFICATION_EXPIRED",
  SESSION_IDLE_EXPIRED: "SESSION_IDLE_EXPIRED",
  SINGLE_SESSION_ACTIVE: "SINGLE_SESSION_ACTIVE",
  UNAUTHENTICATED: "UNAUTHENTICATED",
} as const;

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

export const LOCKOUT_THRESHOLD = 5;

/** 30 minutes */
export const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

export const USER_ROLES = ["admin", "staff"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}
