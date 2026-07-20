export const SESSION_COOKIE_NAME = "crm_session";
export const DEVICE_COOKIE_NAME = "crm_device";

/** 7 days — absolute session ceiling; idle timeout revokes earlier */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** After Cloudflare Access, CRM login must complete within this window */
export const ACCESS_LOGIN_WINDOW_MS = 5 * 60 * 1000;

/** Cloudflare Access logout path (production). Prefer getPostLogoutRedirectPath(). */
export { CLOUDFLARE_ACCESS_LOGOUT_PATH as ACCESS_LOGOUT_PATH } from "@/lib/auth/logout-redirect";
export { getPostLogoutRedirectPath } from "@/lib/auth/logout-redirect";

/** Throttle session last_activity writes (ms) */
export const SESSION_ACTIVITY_TOUCH_INTERVAL_MS = 30 * 1000;

/** Idle logout after this many minutes with no user activity */
export const INACTIVITY_LOGOUT_MINUTES = 30;
export const INACTIVITY_LOGOUT_MS = INACTIVITY_LOGOUT_MINUTES * 60 * 1000;
export const INACTIVITY_LOGOUT_SECONDS = INACTIVITY_LOGOUT_MINUTES * 60;

export const AUTH_ERROR_CODES = {
  ACCESS_VERIFICATION_EXPIRED: "ACCESS_VERIFICATION_EXPIRED",
  SESSION_IDLE_EXPIRED: "SESSION_IDLE_EXPIRED",
  SESSION_REVOKED: "SESSION_REVOKED",
  SESSION_INVALID: "SESSION_INVALID",
  /** Staff must complete Cloudflare Access again after global idle exemption was turned off. */
  SESSION_ACCESS_REVERIFY_REQUIRED: "SESSION_ACCESS_REVERIFY_REQUIRED",
  MUST_CHANGE_PASSWORD: "MUST_CHANGE_PASSWORD",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  UNAUTHORIZED_EMAIL: "UNAUTHORIZED_EMAIL",
  IP_EMAIL_RESTRICTED: "IP_EMAIL_RESTRICTED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  DEVICE_NEW_PENDING: "DEVICE_NEW_PENDING",
  DEVICE_PENDING_REVIEW: "DEVICE_PENDING_REVIEW",
  DEVICE_REJECTED: "DEVICE_REJECTED",
  DEVICE_REVOKED: "DEVICE_REVOKED",
  DEVICE_LIMIT_REACHED: "DEVICE_LIMIT_REACHED",
  DEVICE_REAPPROVAL_PENDING: "DEVICE_REAPPROVAL_PENDING",
  SESSION_DEVICE_REVOKED: "SESSION_DEVICE_REVOKED",
} as const;

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

export const LOCKOUT_THRESHOLD = 3;

/** Legacy sentinel for rows locked before lock timestamps were stored */
export const LOCKOUT_PERSISTENT_UNTIL = "9999-12-31T23:59:59.000Z";

export const LOCKOUT_REASON_TOO_MANY_ATTEMPTS =
  "Too many failed login attempts";

export const USER_ROLES = ["admin", "staff"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}
