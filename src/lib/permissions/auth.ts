import { getCurrentUser as getSessionUser } from "@/lib/auth/session";
import type { User } from "../../../drizzle/schema/users";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { PermissionError } from "@/lib/permissions/customers";

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly auditAction?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export async function getCurrentUser(): Promise<User | null> {
  return getSessionUser();
}

export async function requireAuth(request?: Request): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    if (request) {
      await logPermissionDenied(request, {
        action: "permission.denied.unauthenticated",
        entityType: "auth",
      });
    }
    throw new AuthError(401, "未登录", "permission.denied.unauthenticated");
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
  if (error instanceof AuthError || error instanceof PermissionError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: "服务器错误" }, { status: 500 });
}

export function getRoleDashboardPath(role: User["role"]): string {
  return role === "admin" ? "/admin" : "/staff";
}
