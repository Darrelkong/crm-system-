import {
  getSessionTokenFromCookies,
  validateSessionToken,
} from "@/lib/auth/session";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import { userMustChangePassword } from "@/lib/auth/change-password";
import {
  AuthError,
  authErrorResponse,
} from "@/lib/permissions/auth";
import type { User } from "../../../drizzle/schema/users";

export type AuthSessionContext = {
  user: User;
  sessionId: string;
};

/**
 * Require an active CRM session and return user + sessionId.
 * Mirrors requireAuth active / must-change-password gates.
 */
export async function requireAuthSession(): Promise<AuthSessionContext> {
  const token = await getSessionTokenFromCookies();
  if (!token) {
    throw new AuthError(
      401,
      "未登录",
      undefined,
      AUTH_ERROR_CODES.UNAUTHENTICATED,
    );
  }

  const validation = await validateSessionToken(token, { touch: true });
  if (!validation.ok) {
    if (validation.errorCode === AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED) {
      throw new AuthError(
        401,
        "session idle expired",
        undefined,
        AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED,
      );
    }
    if (validation.errorCode === AUTH_ERROR_CODES.SESSION_REVOKED) {
      throw new AuthError(
        401,
        "session revoked",
        undefined,
        AUTH_ERROR_CODES.SESSION_REVOKED,
      );
    }
    if (validation.errorCode === AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED) {
      throw new AuthError(
        401,
        "device revoked",
        undefined,
        AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED,
      );
    }
    if (
      validation.errorCode ===
      AUTH_ERROR_CODES.SESSION_ACCESS_REVERIFY_REQUIRED
    ) {
      throw new AuthError(
        401,
        "session access reverify required",
        "auth.session.access_reverify",
        AUTH_ERROR_CODES.SESSION_ACCESS_REVERIFY_REQUIRED,
      );
    }
    throw new AuthError(
      401,
      "未登录",
      undefined,
      AUTH_ERROR_CODES.UNAUTHENTICATED,
    );
  }

  const { user, sessionId } = validation.session;
  if (user.isActive !== 1) {
    throw new AuthError(403, "账号已禁用");
  }
  if (userMustChangePassword(user)) {
    throw new AuthError(
      403,
      "must change password",
      "auth.must_change_password",
      AUTH_ERROR_CODES.MUST_CHANGE_PASSWORD,
    );
  }

  return { user, sessionId };
}

export { authErrorResponse, AuthError };
