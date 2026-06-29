import type { AdminUserView } from "@/lib/users-admin/types";

export type AdminUserStats = {
  total: number;
  current: number;
  active: number;
  deleted: number;
  admins: number;
  staff: number;
};

export function isDeletedAdminUser(
  user: Pick<AdminUserView, "status" | "deleted_at">,
): boolean {
  return user.status === "deleted" || user.deleted_at !== null;
}

export function computeAdminUserStats(users: AdminUserView[]): AdminUserStats {
  const currentUsers = users.filter((user) => !isDeletedAdminUser(user));
  const deleted = users.filter((user) => isDeletedAdminUser(user)).length;
  const active = currentUsers.filter((user) => user.status === "active").length;

  return {
    total: users.length,
    current: currentUsers.length,
    active,
    deleted,
    admins: currentUsers.filter(
      (user) => user.role === "admin" && user.status === "active",
    ).length,
    staff: currentUsers.filter(
      (user) => user.role === "staff" && user.status === "active",
    ).length,
  };
}
