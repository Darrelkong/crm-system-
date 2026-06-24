export const SESSION_COOKIE_NAME = "crm_session";

/** 7 days */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const LOCKOUT_THRESHOLD = 5;

/** 30 minutes */
export const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

export const USER_ROLES = ["admin", "staff"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}
