import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import { resetLoginFailures } from "@/lib/auth/lockout";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getUserById } from "@/lib/users/queries";
import type { User } from "../../../drizzle/schema/users";
import type { Database } from "@/lib/db";

async function clearUserSessions(db: Database, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(eq(schema.sessions.userId, userId));
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
    throw new UserAdminError("not_found", "用户不存在");
  }

  const db = getDb();
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
    throw new UserAdminError("not_found", "用户不存在");
  }

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
    throw new UserAdminError("not_found", "用户不存在");
  }

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
