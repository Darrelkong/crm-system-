import { requireAuth, AuthError } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import type { User } from "../../../drizzle/schema/users";

/** Admin-only access for user management, login logs, and system settings. */
export async function requireUserManagementAdmin(
  request?: Request,
): Promise<User> {
  const user = await requireAuth(request);
  if (user.role !== "admin") {
    if (request) {
      await logPermissionDenied(request, {
        action: "permission.denied.user_management",
        userId: user.id,
        entityType: "user",
      });
    }
    throw new AuthError(
      403,
      "需要管理员权限才能管理用户",
      "permission.denied.user_management",
    );
  }
  return user;
}
