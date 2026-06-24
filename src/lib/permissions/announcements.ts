import { requireAuth, AuthError } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import type { User } from "../../../drizzle/schema/users";

export async function requireAnnouncementManageAdmin(
  request?: Request,
): Promise<User> {
  const user = await requireAuth(request);
  if (user.role !== "admin") {
    if (request) {
      await logPermissionDenied(request, {
        action: "permission.denied.announcement_manage",
        userId: user.id,
        entityType: "announcement",
      });
    }
    throw new AuthError(
      403,
      "需要管理员权限才能管理公告",
      "permission.denied.announcement_manage",
    );
  }
  return user;
}
