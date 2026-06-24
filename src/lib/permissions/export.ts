import { requireAuth, AuthError } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import type { User } from "../../../drizzle/schema/users";

/** Admin-only access for customer CSV export APIs and pages. */
export async function requireExportAdmin(request?: Request): Promise<User> {
  const user = await requireAuth(request);
  if (user.role !== "admin") {
    if (request) {
      await logPermissionDenied(request, {
        action: "permission.denied.export_customers",
        userId: user.id,
        entityType: "export",
      });
    }
    throw new AuthError(
      403,
      "需要管理员权限才能导出客户",
      "permission.denied.export_customers",
    );
  }
  return user;
}
