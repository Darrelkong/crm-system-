import type { User } from "../../../drizzle/schema/users";

/**
 * Mail Workspace route entry is authenticated CRM access only.
 * Enabled Mail access is enforced by Mail session APIs and workspace UI —
 * not by CRM admin role.
 */
export function getMailWorkspaceLayoutRedirect(
  user: Pick<User, "id" | "role"> | null,
): string | null {
  if (!user) {
    return "/login?redirect=/mail";
  }
  return null;
}

export function resolveMailWorkspaceDashboardHref(
  role: User["role"],
): "/admin" | "/staff" {
  return role === "admin" ? "/admin" : "/staff";
}
