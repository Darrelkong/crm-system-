import { requireAuth, AuthError } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import type { User } from "../../../drizzle/schema/users";

/** Admin-only access for customer CSV import APIs and pages. */
export async function requireImportAdmin(request?: Request): Promise<User> {
  const user = await requireAuth(request);
  if (user.role !== "admin") {
    if (request) {
      await logPermissionDenied(request, {
        action: "permission.denied.import_customers",
        userId: user.id,
        entityType: "import",
      });
    }
    throw new AuthError(
      403,
      "需要管理员权限才能导入客户",
      "permission.denied.import_customers",
    );
  }
  return user;
}
