import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { assertCustomerNotPendingOnHoldCreate } from "@/lib/customers/pending-on-hold-access";
import {
  listCustomerAssignees,
  type CustomerAssigneeRecord,
} from "@/lib/customers/assignees";
import { validateCollaboratorUserIds } from "@/lib/customers/assignees-validation";

export type AssigneeMutationErrorCode =
  | "INVALID_COLLABORATOR_IDS"
  | "CUSTOMER_NOT_FOUND"
  | "COLLABORATOR_INCLUDES_OWNER"
  | "COLLABORATOR_INCLUDES_ADMIN"
  | "COLLABORATOR_USER_NOT_FOUND"
  | "COLLABORATOR_USER_NOT_STAFF"
  | "COLLABORATOR_USER_INACTIVE"
  | "COLLABORATOR_USER_DELETED";

export class AssigneeMutationError extends Error {
  constructor(
    public readonly code: AssigneeMutationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AssigneeMutationError";
  }
}

export type ApplyCollaboratorAssigneesInput = {
  customerId: string;
  collaboratorUserIds: unknown;
  assignedBy: string;
  now?: string;
};

export type ApplyCollaboratorAssigneesResult = {
  collaborators: CustomerAssigneeRecord[];
  assignees: CustomerAssigneeRecord[];
};

/** Reserved for D-2d API — pending on_hold customers must not adjust assignees. */
export async function assertCustomerCollaboratorsMutable(
  db: Database,
  customerId: string,
): Promise<void> {
  await assertCustomerNotPendingOnHoldCreate(db, customerId);
}

export async function applyCollaboratorAssignees(
  db: Database,
  input: ApplyCollaboratorAssigneesInput,
): Promise<ApplyCollaboratorAssigneesResult> {
  const idsValidation = validateCollaboratorUserIds(input.collaboratorUserIds);
  if (!idsValidation.ok) {
    throw new AssigneeMutationError(
      "INVALID_COLLABORATOR_IDS",
      idsValidation.errors[0]?.message ?? "无效的共同负责员工列表",
    );
  }

  const collaboratorUserIds = idsValidation.value;
  const now = input.now ?? new Date().toISOString();

  const customerRows = await db
    .select({
      id: schema.customers.id,
      ownerId: schema.customers.ownerId,
    })
    .from(schema.customers)
    .where(eq(schema.customers.id, input.customerId))
    .limit(1);

  const customer = customerRows[0];
  if (!customer) {
    throw new AssigneeMutationError("CUSTOMER_NOT_FOUND", "客户不存在");
  }

  if (customer.ownerId) {
    for (const userId of collaboratorUserIds) {
      if (userId === customer.ownerId) {
        throw new AssigneeMutationError(
          "COLLABORATOR_INCLUDES_OWNER",
          "不能将主负责员工加入共同负责",
        );
      }
    }
  }

  if (collaboratorUserIds.length > 0) {
    const users = await db
      .select({
        id: schema.users.id,
        role: schema.users.role,
        isActive: schema.users.isActive,
        deletedAt: schema.users.deletedAt,
      })
      .from(schema.users)
      .where(inArray(schema.users.id, collaboratorUserIds));

    const userById = new Map(users.map((user) => [user.id, user]));

    for (const userId of collaboratorUserIds) {
      const user = userById.get(userId);
      if (!user) {
        throw new AssigneeMutationError(
          "COLLABORATOR_USER_NOT_FOUND",
          "用户不存在",
        );
      }

      if (user.role === "admin") {
        throw new AssigneeMutationError(
          "COLLABORATOR_INCLUDES_ADMIN",
          "不能将管理员加入共同负责",
        );
      }

      if (user.role !== "staff") {
        throw new AssigneeMutationError(
          "COLLABORATOR_USER_NOT_STAFF",
          "只能添加员工为共同负责",
        );
      }

      if (user.isActive !== 1) {
        throw new AssigneeMutationError(
          "COLLABORATOR_USER_INACTIVE",
          "不能添加已停用的员工",
        );
      }

      if (user.deletedAt) {
        throw new AssigneeMutationError(
          "COLLABORATOR_USER_DELETED",
          "不能添加已删除的员工",
        );
      }
    }
  }

  const deleteStmt = db
    .delete(schema.customerAssignees)
    .where(
      and(
        eq(schema.customerAssignees.customerId, input.customerId),
        eq(schema.customerAssignees.role, "collaborator"),
      ),
    );

  const insertStmts = collaboratorUserIds.map((userId) =>
    db.insert(schema.customerAssignees).values({
      id: crypto.randomUUID(),
      customerId: input.customerId,
      userId,
      role: "collaborator",
      assignedBy: input.assignedBy,
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    }),
  );

  if (insertStmts.length === 0) {
    await deleteStmt;
  } else {
    await db.batch(
      [deleteStmt, ...insertStmts] as unknown as Parameters<Database["batch"]>[0],
    );
  }

  const assignees = await listCustomerAssignees(db, input.customerId);
  const collaborators = assignees.filter((row) => row.role === "collaborator");

  return { collaborators, assignees };
}
