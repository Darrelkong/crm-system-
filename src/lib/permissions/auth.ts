import { getCurrentUser } from "@/lib/auth/session";
import type { User } from "../../../drizzle/schema/users";

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthError(401, "未登录");
  }
  if (user.isActive !== 1) {
    throw new AuthError(403, "账号已禁用");
  }
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireAuth();
  if (user.role !== "admin") {
    throw new AuthError(403, "需要管理员权限");
  }
  return user;
}

export async function requireStaff(): Promise<User> {
  const user = await requireAuth();
  if (user.role !== "staff") {
    throw new AuthError(403, "需要员工权限");
  }
  return user;
}

export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: "服务器错误" }, { status: 500 });
}

export function getRoleDashboardPath(role: User["role"]): string {
  return role === "admin" ? "/admin" : "/staff";
}
