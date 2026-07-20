import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import { resetLoginFailures } from "@/lib/auth/lockout";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getUserById } from "@/lib/users/queries";
import { buildUserDeletionAuditMetadata } from "@/lib/users-admin/deletion-metadata";
import { appendStaffDeleteAssigneeStatements } from "@/lib/users-admin/staff-delete-assignees";
import { initialDeviceAutoApprovalEligibleForNewRole } from "@/lib/devices/initial-device-auto-approval";
import type { User } from "../../../drizzle/schema/users";
import type { Database } from "@/lib/db";

const STAFF_DELETED_TRANSFER_ACTION = "customer.transferred.staff_deleted";

async function clearUserSessions(db: Database, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(eq(schema.sessions.userId, userId));
}

async function countActiveAdmins(
  db: Database,
  excludeUserId?: string,
): Promise<number> {
  const conditions = [
    eq(schema.users.role, "admin"),
    eq(schema.users.isActive, 1),
    isNull(schema.users.deletedAt),
  ];
  if (excludeUserId) {
    conditions.push(ne(schema.users.id, excludeUserId));
  }

  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(...conditions));

  return rows.length;
}

async function assertCanDisableOrDeleteAdmin(
  db: Database,
  target: User,
): Promise<void> {
  if (target.role !== "admin" || target.isActive !== 1 || target.deletedAt) {
    return;
  }

  const remaining = await countActiveAdmins(db, target.id);
  if (remaining === 0) {
    throw new UserAdminError(
      "last_admin",
      "不能停用或删除最后一个活跃管理员",
    );
  }
}

function assertUserNotDeleted(target: User): void {
  if (target.deletedAt) {
    throw new UserAdminError("user_deleted", "已删除的用户无法执行此操作");
  }
}

export async function createUserAccount(
  actor: User,
  input: {
    name: string;
    email: string;
    role: "admin" | "staff";
    temporaryPassword: string;
    confirmAdminRole?: boolean;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<{ id: string }> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();

  if (!name) {
    throw new UserAdminError("validation", "姓名必填");
  }
  if (!email) {
    throw new UserAdminError("validation", "邮箱必填");
  }

  const passwordCheck = validatePasswordPolicy(input.temporaryPassword);
  if (!passwordCheck.valid) {
    throw new UserAdminError("validation", passwordCheck.message ?? "密码不符合规则");
  }

  if (input.role === "admin" && !input.confirmAdminRole) {
    throw new UserAdminError(
      "validation",
      "创建管理员账号需要 confirmAdminRole: true",
    );
  }

  const db = getDb();
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (existing.length > 0) {
    throw new UserAdminError("duplicate_email", "邮箱已存在");
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(input.temporaryPassword);

  await db.insert(schema.users).values({
    id,
    email,
    displayName: name,
    passwordHash,
    role: input.role,
    isActive: 1,
    failedLoginAttempts: 0,
    lockedUntil: null,
    mustChangePassword: input.role === "staff" ? 1 : 0,
    passwordChangedAt: null,
    passwordResetAt: null,
    // Staff-only one-time first-device auto-approval eligibility.
    // Admin Reset Password must never set this back to 1.
    initialDeviceAutoApprovalEligible:
      initialDeviceAutoApprovalEligibleForNewRole(input.role),
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await writeAuditLog({
    userId: actor.id,
    action: "user.created",
    entityType: "user",
    entityId: id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    metadata: { email, role: input.role },
  });

  return { id };
}

export async function setUserStatus(
  actor: User,
  targetUserId: string,
  status: "active" | "disabled",
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  if (status === "disabled" && targetUserId === actor.id) {
    throw new UserAdminError(
      "self_disable",
      "不能停用当前登录账号",
    );
  }

  const target = await getUserById(targetUserId);
  if (!target) {
    throw new UserAdminError("not_found", "用户不存在", 404);
  }

  assertUserNotDeleted(target);

  const db = getDb();

  if (status === "disabled") {
    await assertCanDisableOrDeleteAdmin(db, target);
  }

  const isActive = status === "active" ? 1 : 0;
  const now = new Date().toISOString();

  await db
    .update(schema.users)
    .set({ isActive, updatedAt: now })
    .where(eq(schema.users.id, targetUserId));

  if (status === "disabled") {
    await clearUserSessions(db, targetUserId);
  }

  await writeAuditLog({
    userId: actor.id,
    action: status === "active" ? "user.enabled" : "user.disabled",
    entityType: "user",
    entityId: targetUserId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { email: target.email, status },
  });
}

export async function softDeleteUserAccount(
  actor: User,
  targetUserId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<{ transferredCount: number }> {
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
  await assertCanDisableOrDeleteAdmin(db, target);

  const now = new Date().toISOString();
  const customersToTransfer = await db
    .select({
      id: schema.customers.id,
    })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.ownerId, targetUserId),
        ne(schema.customers.status, "archived"),
      ),
    );

  const batchStatements = [];

  for (const customer of customersToTransfer) {
    batchStatements.push(
      db
        .update(schema.customers)
        .set({
          ownerId: actor.id,
          updatedBy: actor.id,
          updatedAt: now,
        })
        .where(eq(schema.customers.id, customer.id)),
    );

    batchStatements.push(
      db.insert(schema.fieldChangeLogs).values({
        id: crypto.randomUUID(),
        customerId: customer.id,
        fieldName: "owner_id",
        oldValue: targetUserId,
        newValue: actor.id,
        changedBy: actor.id,
        changedAt: now,
      }),
    );

    batchStatements.push(
      db.insert(schema.auditLogs).values({
        id: crypto.randomUUID(),
        userId: actor.id,
        action: STAFF_DELETED_TRANSFER_ACTION,
        entityType: "customer",
        entityId: customer.id,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        metadata: JSON.stringify({
          previousOwnerId: targetUserId,
          previousOwnerName: target.displayName,
          newOwnerId: actor.id,
          newOwnerName: actor.displayName,
          reason: "staff_deleted_transfer",
        }),
        createdAt: now,
      }),
    );
  }

  const assigneeSync = await appendStaffDeleteAssigneeStatements(
    db,
    batchStatements,
    {
      targetUserId,
      transferAdminId: actor.id,
      transferredCustomerIds: customersToTransfer.map((row) => row.id),
      now,
    },
  );

  batchStatements.push(
    db
      .update(schema.users)
      .set({
        isActive: 0,
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.users.id, targetUserId)),
  );

  batchStatements.push(
    db
      .update(schema.sessions)
      .set({ revokedAt: now })
      .where(eq(schema.sessions.userId, targetUserId)),
  );

  batchStatements.push(
    db.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      userId: actor.id,
      action: "user.deleted",
      entityType: "user",
      entityId: targetUserId,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      metadata: JSON.stringify({
        ...buildUserDeletionAuditMetadata({
          email: target.email,
          transferredCustomerCount: customersToTransfer.length,
          actor,
        }),
        primaryAssigneesTransferredCount:
          assigneeSync.primaryAssigneesTransferredCount,
        collaboratorAssigneesRemovedCount:
          assigneeSync.collaboratorAssigneesRemovedCount,
      }),
      createdAt: now,
    }),
  );

  await db.batch(
    batchStatements as unknown as Parameters<Database["batch"]>[0],
  );

  return { transferredCount: customersToTransfer.length };
}

export async function resetUserPassword(
  actor: User,
  targetUserId: string,
  newPassword: string,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  const passwordCheck = validatePasswordPolicy(newPassword);
  if (!passwordCheck.valid) {
    throw new UserAdminError("validation", passwordCheck.message ?? "密码不符合规则");
  }

  const target = await getUserById(targetUserId);
  if (!target) {
    throw new UserAdminError("not_found", "用户不存在", 404);
  }

  assertUserNotDeleted(target);

  const db = getDb();
  const passwordHash = await hashPassword(newPassword);
  const now = new Date().toISOString();

  await db
    .update(schema.users)
    .set({
      passwordHash,
      mustChangePassword: 1,
      passwordResetAt: now,
      updatedAt: now,
    })
    .where(eq(schema.users.id, targetUserId));

  await clearUserSessions(db, targetUserId);

  await resetLoginFailures(targetUserId);

  await writeAuditLog({
    userId: actor.id,
    action: "user.password_reset",
    entityType: "user",
    entityId: targetUserId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { email: target.email },
  });
}

export async function unlockUserAccount(
  actor: User,
  targetUserId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  const target = await getUserById(targetUserId);
  if (!target) {
    throw new UserAdminError("not_found", "用户不存在", 404);
  }

  assertUserNotDeleted(target);

  await resetLoginFailures(targetUserId);

  await writeAuditLog({
    userId: actor.id,
    action: "user.unlocked",
    entityType: "user",
    entityId: targetUserId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { email: target.email },
  });
}

export class UserAdminError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "UserAdminError";
  }
}
