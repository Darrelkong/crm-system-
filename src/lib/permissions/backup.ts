import { requireAuth, AuthError } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import type { User } from "../../../drizzle/schema/users";

/** Admin-only access for backup APIs and pages. */
export async function requireBackupAdmin(request?: Request): Promise<User> {
  const user = await requireAuth(request);
  if (user.role !== "admin") {
    if (request) {
      await logPermissionDenied(request, {
        action: "permission.denied.backup_run",
        userId: user.id,
        entityType: "backup",
      });
    }
    throw new AuthError(
      403,
      "需要管理员权限才能管理备份",
      "permission.denied.backup_run",
    );
  }
  return user;
}
