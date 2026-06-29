import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getUserById } from "@/lib/users/queries";
import { UserAdminError } from "@/lib/users-admin/service";
import type { User } from "../../../drizzle/schema/users";

export type StaffDeletePreview = {
  ok: true;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  transferTo: {
    id: string;
    name: string;
    email: string;
  };
  impact: {
    ownedCustomersCount: number;
    collaboratorCustomersCount: number;
    openTasksCount: number;
    pendingApprovalsCount: number;
  };
};

export async function getStaffDeletePreview(
  actor: User,
  targetUserId: string,
): Promise<StaffDeletePreview> {
  if (targetUserId === actor.id) {
    throw new UserAdminError(
      "self_delete",
      "不能删除当前登录账号",
    );
  }

  const target = await getUserById(targetUserId);
  if (!target) {
    throw new UserAdminError("not_found", "用户不存在", 404);
  }

  if (target.deletedAt) {
    throw new UserAdminError("already_deleted", "用户已删除");
  }

  if (target.role === "admin") {
    throw new UserAdminError("cannot_delete_admin", "不能删除管理员账号");
  }

  const db = getDb();

  const [ownedCustomers, collaboratorRows, openTasks, pendingApprovals] =
    await Promise.all([
      db
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.ownerId, targetUserId),
            ne(schema.customers.status, "archived"),
          ),
        ),
      db
        .select({ id: schema.customerAssignees.id })
        .from(schema.customerAssignees)
        .where(
          and(
            eq(schema.customerAssignees.userId, targetUserId),
            eq(schema.customerAssignees.role, "collaborator"),
          ),
        ),
      db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.assignedTo, targetUserId),
            eq(schema.tasks.status, "open"),
          ),
        ),
      db
        .select({ id: schema.approvals.id })
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.requestedBy, targetUserId),
            eq(schema.approvals.status, "pending"),
          ),
        ),
    ]);

  return {
    ok: true,
    user: {
      id: target.id,
      name: target.displayName,
      email: target.email,
      role: target.role,
    },
    transferTo: {
      id: actor.id,
      name: actor.displayName,
      email: actor.email,
    },
    impact: {
      ownedCustomersCount: ownedCustomers.length,
      collaboratorCustomersCount: collaboratorRows.length,
      openTasksCount: openTasks.length,
      pendingApprovalsCount: pendingApprovals.length,
    },
  };
}
