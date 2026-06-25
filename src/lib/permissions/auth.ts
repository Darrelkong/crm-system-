import {
  getCurrentUser as getSessionUser,
  getSessionTokenFromCookies,
  validateSessionToken,
} from "@/lib/auth/session";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import { getPostLogoutRedirectPath } from "@/lib/auth/logout-redirect";
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

export async function requireAuth(request?: Request): Promise<User> {
  const token = await getSessionTokenFromCookies();
  if (token) {
    const validation = await validateSessionToken(token, { touch: true });
    if (validation.ok) {
      if (validation.session.user.isActive !== 1) {
        throw new AuthError(403, "账号已禁用");
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
    return Response.json(
      {
        error: error.message,
        errorCode: error.errorCode ?? error.auditAction ?? "INSUFFICIENT_PERMISSIONS",
        redirect:
          error.errorCode === AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED
            ? getPostLogoutRedirectPath()
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
