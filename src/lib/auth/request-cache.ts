import { cache } from "react";
import {
  getSessionTokenFromCookies,
  validateSessionToken,
} from "@/lib/auth/session";
import type { SessionValidationResult } from "@/lib/auth/session";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import { userMustChangePassword } from "@/lib/auth/change-password";
import type { User } from "../../../drizzle/schema/users";
import { AuthError } from "@/lib/permissions/auth";

/**
 * Request-scoped session validation using React's cache().
 *
 * The full D1 query (sessions + users + device authorization + system_settings)
 * runs at most once per SSR render pass (per HTTP request). Layout and page
 * Server Components calling requireAuthCached / requireAdminCached /
 * requireStaffCached share this single result without additional D1 round-trips.
 *
 * Safety guarantees:
 * - react.cache() is scoped to the React render tree (per request), never global.
 * - Different requests, users, and session tokens always get independent caches.
 * - Middleware and API Route Handlers are outside the React render tree and must
 *   use their own auth calls (validateSessionFromRequest / requireAuth).
 */
const getRequestValidation = cache(
  async (): Promise<SessionValidationResult> => {
    const token = await getSessionTokenFromCookies();
    if (!token) {
      return { ok: false, reason: "missing" };
    }
    return validateSessionToken(token, { touch: true });
  },
);

/**
 * Resolves a SessionValidationResult into an authenticated User or throws the
 * appropriate AuthError. Exported as a pure function so the error-handling
 * logic can be unit-tested independently of the request-cache mechanism.
 */
export function resolveAuthFromValidation(
  result: SessionValidationResult,
  options?: { allowMustChangePassword?: boolean },
): User {
  if (result.ok) {
    const { user } = result.session;
    if (user.isActive !== 1) {
      throw new AuthError(403, "账号已禁用");
    }
    if (
      !options?.allowMustChangePassword &&
      userMustChangePassword(user)
    ) {
      throw new AuthError(
        403,
        "must change password",
        "auth.must_change_password",
        AUTH_ERROR_CODES.MUST_CHANGE_PASSWORD,
      );
    }
    return user;
  }

  const { reason, errorCode } = result;

  if (
    reason === "idle_expired" ||
    errorCode === AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED
  ) {
    throw new AuthError(
      401,
      "session idle expired",
      "auth.session.idle_expired",
      AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED,
    );
  }
  if (
    reason === "revoked" ||
    errorCode === AUTH_ERROR_CODES.SESSION_REVOKED
  ) {
    throw new AuthError(
      401,
      "session revoked",
      "auth.session.revoked",
      AUTH_ERROR_CODES.SESSION_REVOKED,
    );
  }
  if (
    reason === "device_revoked" ||
    errorCode === AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED
  ) {
    throw new AuthError(
      401,
      "device authorization revoked",
      "device.session.revoked",
      AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED,
    );
  }
  if (
    reason === "invalid" ||
    errorCode === AUTH_ERROR_CODES.SESSION_INVALID
  ) {
    throw new AuthError(
      401,
      "session invalid",
      "auth.session.invalid",
      AUTH_ERROR_CODES.SESSION_INVALID,
    );
  }

  // "missing" or "inactive_user" → treated as unauthenticated
  throw new AuthError(
    401,
    "未登录",
    "permission.denied.unauthenticated",
    AUTH_ERROR_CODES.UNAUTHENTICATED,
  );
}

/**
 * Cached requireAuth for Server Components (layout / page).
 * Behaviorally identical to requireAuth() in auth.ts; the underlying D1
 * session query runs at most once per SSR request due to react.cache().
 *
 * Do NOT use in Middleware or API Route Handlers — those must call
 * requireAuth() / validateSessionFromRequest() directly.
 */
export async function requireAuthCached(
  options?: { allowMustChangePassword?: boolean },
): Promise<User> {
  const result = await getRequestValidation();
  return resolveAuthFromValidation(result, options);
}

/**
 * Cached requireAdmin for Server Components.
 * Behaviorally identical to requireAdmin() in auth.ts.
 */
export async function requireAdminCached(): Promise<User> {
  const user = await requireAuthCached();
  if (user.role !== "admin") {
    throw new AuthError(
      403,
      "需要管理员权限",
      "permission.denied.admin_required",
    );
  }
  return user;
}

/**
 * Cached requireStaff for Server Components.
 * Behaviorally identical to requireStaff() in auth.ts.
 */
export async function requireStaffCached(): Promise<User> {
  const user = await requireAuthCached();
  if (user.role !== "staff") {
    throw new AuthError(403, "需要员工权限");
  }
  return user;
}

/**
 * Returns the current user for the active request (from cache if available).
 * Returns null if unauthenticated, session is invalid, or user is inactive.
 * Does not throw.
 */
export async function getCurrentUserCached(): Promise<User | null> {
  const result = await getRequestValidation();
  if (!result.ok) return null;
  const { user } = result.session;
  return user.isActive === 1 ? user : null;
}
