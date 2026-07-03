import {
  getCurrentUser as getSessionUser,
  getSessionTokenFromCookies,
  validateSessionToken,
} from "@/lib/auth/session";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import { userMustChangePassword } from "@/lib/auth/change-password";
import type { User } from "../../../drizzle/schema/users";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { PermissionError } from "@/lib/permissions/customers";

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly auditAction?: string,
    public readonly errorCode?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export async function getCurrentUser(): Promise<User | null> {
  return getSessionUser({ touch: true });
}

export async function requireAuth(
  request?: Request,
  options?: { allowMustChangePassword?: boolean },
): Promise<User> {
  const token = await getSessionTokenFromCookies();
  if (token) {
    const validation = await validateSessionToken(token, { touch: true });
    if (validation.ok) {
      if (validation.session.user.isActive !== 1) {
        throw new AuthError(403, "账号已禁用");
      }
      if (
        !options?.allowMustChangePassword &&
        userMustChangePassword(validation.session.user)
      ) {
        throw new AuthError(
          403,
          "must change password",
          "auth.must_change_password",
          AUTH_ERROR_CODES.MUST_CHANGE_PASSWORD,
        );
      }
      return validation.session.user;
    }
    if (validation.errorCode === AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED) {
      if (request) {
        await logPermissionDenied(request, {
          action: "auth.session.idle_expired",
          entityType: "auth",
        });
      }
      throw new AuthError(
        401,
        "session idle expired",
        "auth.session.idle_expired",
        AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED,
      );
    }
    if (
      validation.reason === "revoked" ||
      validation.errorCode === AUTH_ERROR_CODES.SESSION_REVOKED
    ) {
      if (request) {
        await logPermissionDenied(request, {
          action: "auth.session.revoked",
          entityType: "auth",
        });
      }
      throw new AuthError(
        401,
        "session revoked",
        "auth.session.revoked",
        AUTH_ERROR_CODES.SESSION_REVOKED,
      );
    }
    if (
      validation.reason === "device_revoked" ||
      validation.errorCode === AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED
    ) {
      if (request) {
        await logPermissionDenied(request, {
          action: "device.session.revoked",
          entityType: "auth",
        });
      }
      throw new AuthError(
        401,
        "device authorization revoked",
        "device.session.revoked",
        AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED,
      );
    }
    if (
      validation.reason === "invalid" ||
      validation.errorCode === AUTH_ERROR_CODES.SESSION_INVALID
    ) {
      throw new AuthError(
        401,
        "session invalid",
        "auth.session.invalid",
        AUTH_ERROR_CODES.SESSION_INVALID,
      );
    }
  }

  const user = await getSessionUser({ touch: false });
  if (!user) {
    if (request) {
      await logPermissionDenied(request, {
        action: "permission.denied.unauthenticated",
        entityType: "auth",
      });
    }
    throw new AuthError(
      401,
      "未登录",
      "permission.denied.unauthenticated",
      AUTH_ERROR_CODES.UNAUTHENTICATED,
    );
  }
  if (user.isActive !== 1) {
    throw new AuthError(403, "账号已禁用");
  }
  if (!options?.allowMustChangePassword && userMustChangePassword(user)) {
    throw new AuthError(
      403,
      "must change password",
      "auth.must_change_password",
      AUTH_ERROR_CODES.MUST_CHANGE_PASSWORD,
    );
  }
  return user;
}

export async function requireAdmin(request?: Request): Promise<User> {
  const user = await requireAuth(request);
  if (user.role !== "admin") {
    if (request) {
      await logPermissionDenied(request, {
        action: "permission.denied.admin_required",
        userId: user.id,
        entityType: "auth",
      });
    }
    throw new AuthError(
      403,
      "需要管理员权限",
      "permission.denied.admin_required",
    );
  }
  return user;
}

export async function requireStaff(request?: Request): Promise<User> {
  const user = await requireAuth(request);
  if (user.role !== "staff") {
    if (request) {
      await logPermissionDenied(request, {
        action: "permission.denied.staff_required",
        userId: user.id,
        entityType: "auth",
      });
    }
    throw new AuthError(403, "需要员工权限");
  }
  return user;
}

export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    const sessionEndCodes = [
      AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED,
      AUTH_ERROR_CODES.SESSION_REVOKED,
      AUTH_ERROR_CODES.SESSION_INVALID,
      AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED,
    ] as string[];
    const errorCode =
      error.errorCode ?? error.auditAction ?? "INSUFFICIENT_PERMISSIONS";
    return Response.json(
      {
        error: error.message,
        errorCode,
        redirect:
          sessionEndCodes.includes(errorCode)
            ? "/login"
            : errorCode === AUTH_ERROR_CODES.MUST_CHANGE_PASSWORD
              ? "/change-password"
              : undefined,
      },
      { status: error.status },
    );
  }
  if (error instanceof PermissionError) {
    return Response.json(
      {
        error: error.message,
        errorCode: error.auditAction ?? "INSUFFICIENT_PERMISSIONS",
      },
      { status: error.status },
    );
  }
  return Response.json(
    { error: "服务器错误", errorCode: "SERVER_ERROR" },
    { status: 500 },
  );
}

export function getRoleDashboardPath(role: User["role"]): string {
  return role === "admin" ? "/admin" : "/staff";
}

export function getPostLoginRedirectPath(user: User): string {
  if (userMustChangePassword(user)) {
    return "/change-password";
  }
  return getRoleDashboardPath(user.role);
}
