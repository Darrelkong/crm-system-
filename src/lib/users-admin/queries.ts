import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { AdminUserView, LoginLogView } from "@/lib/users-admin/types";
import { parseUserDeletionMetadata } from "@/lib/users-admin/deletion-metadata";
import {
  isAccountLocked,
  isLoginLockoutExempt,
} from "@/lib/auth/lockout";
import {
  LOCKOUT_PERSISTENT_UNTIL,
  LOCKOUT_REASON_TOO_MANY_ATTEMPTS,
} from "@/lib/auth/constants";
import type { User } from "../../../drizzle/schema/users";

function formatUserRow(
  user: User,
  lastLoginAt: string | null,
  recentLoginCount: number,
  failedLoginMeta: {
    lastFailedLoginAt: string | null;
    lockedAtFromLog: string | null;
  },
  deletionMeta?: ReturnType<typeof parseUserDeletionMetadata>,
): AdminUserView {
  const status: AdminUserView["status"] = user.deletedAt
    ? "deleted"
    : user.isActive === 1
      ? "active"
      : "disabled";

  const lockoutExempt = isLoginLockoutExempt(user);
  const locked = isAccountLocked(user);
  const lockedAt =
    locked && user.lockedUntil
      ? user.lockedUntil === LOCKOUT_PERSISTENT_UNTIL
        ? failedLoginMeta.lockedAtFromLog
        : user.lockedUntil
      : null;

  return {
    id: user.id,
    name: user.displayName,
    email: user.email,
    role: user.role,
    status,
    failed_login_count: user.failedLoginAttempts,
    locked_until: user.lockedUntil,
    is_locked: locked,
    lockout_exempt: lockoutExempt,
    last_failed_login_at: failedLoginMeta.lastFailedLoginAt,
    locked_at: lockedAt,
    lock_reason: locked ? LOCKOUT_REASON_TOO_MANY_ATTEMPTS : null,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    deleted_at: user.deletedAt,
    deleted_by_name: deletionMeta?.deleted_by_name ?? null,
    transferred_customer_count:
      deletionMeta?.transferred_customer_count ?? null,
    transferred_to_admin_name:
      deletionMeta?.transferred_to_admin_name ?? null,
    last_login_at: lastLoginAt,
    recent_login_count: recentLoginCount,
  };
}

export async function listUsersForAdmin(): Promise<AdminUserView[]> {
  const db = getDb();
  const users = await db
    .select()
    .from(schema.users)
    .orderBy(asc(schema.users.email));

  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const loginRows = await db
    .select({
      userId: schema.loginLogs.userId,
      createdAt: schema.loginLogs.createdAt,
      success: schema.loginLogs.success,
    })
    .from(schema.loginLogs)
    .where(eq(schema.loginLogs.success, 1))
    .orderBy(desc(schema.loginLogs.createdAt));

  const failedLoginRows = await db
    .select({
      userId: schema.loginLogs.userId,
      createdAt: schema.loginLogs.createdAt,
      failureReason: schema.loginLogs.failureReason,
    })
    .from(schema.loginLogs)
    .where(eq(schema.loginLogs.success, 0))
    .orderBy(desc(schema.loginLogs.createdAt));

  const lastLoginByUser = new Map<string, string>();
  const recentCountByUser = new Map<string, number>();
  const lastFailedLoginByUser = new Map<string, string>();
  const lockedAtFromLogByUser = new Map<string, string>();

  for (const row of loginRows) {
    if (!row.userId) continue;
    if (!lastLoginByUser.has(row.userId)) {
      lastLoginByUser.set(row.userId, row.createdAt);
    }
    if (row.createdAt >= sevenDaysAgo) {
      recentCountByUser.set(
        row.userId,
        (recentCountByUser.get(row.userId) ?? 0) + 1,
      );
    }
  }

  for (const row of failedLoginRows) {
    if (!row.userId) continue;
    if (!lastFailedLoginByUser.has(row.userId)) {
      lastFailedLoginByUser.set(row.userId, row.createdAt);
    }
    if (
      row.failureReason === "account_locked" &&
      !lockedAtFromLogByUser.has(row.userId)
    ) {
      lockedAtFromLogByUser.set(row.userId, row.createdAt);
    }
  }

  const deletedUserIds = users
    .filter((user) => user.deletedAt)
    .map((user) => user.id);
  const deletionMetadataByUser = await loadUserDeletionMetadata(deletedUserIds);

  return users.map((user) =>
    formatUserRow(
      user,
      lastLoginByUser.get(user.id) ?? null,
      recentCountByUser.get(user.id) ?? 0,
      {
        lastFailedLoginAt: lastFailedLoginByUser.get(user.id) ?? null,
        lockedAtFromLog: lockedAtFromLogByUser.get(user.id) ?? null,
      },
      user.deletedAt ? deletionMetadataByUser.get(user.id) : undefined,
    ),
  );
}

export async function listLoginLogsForAdmin(input: {
  email?: string | null;
  success?: boolean | null;
  limit?: number;
}): Promise<LoginLogView[]> {
  const db = getDb();
  const limit = input.limit ?? 100;

  const conditions = [];
  if (input.email?.trim()) {
    conditions.push(
      eq(schema.loginLogs.emailAttempted, input.email.trim().toLowerCase()),
    );
  }
  if (input.success === true) {
    conditions.push(eq(schema.loginLogs.success, 1));
  }
  if (input.success === false) {
    conditions.push(eq(schema.loginLogs.success, 0));
  }

  const query = db
    .select()
    .from(schema.loginLogs)
    .orderBy(desc(schema.loginLogs.createdAt))
    .limit(limit);

  const rows =
    conditions.length > 0
      ? await query.where(and(...conditions))
      : await query;

  return rows.map((row) => ({
    id: row.id,
    email: row.emailAttempted,
    success: row.success === 1,
    failure_reason: row.failureReason,
    ip_address: row.ipAddress,
    user_agent: row.userAgent,
    created_at: row.createdAt,
  }));
}

async function loadUserDeletionMetadata(
  deletedUserIds: string[],
): Promise<Map<string, ReturnType<typeof parseUserDeletionMetadata>>> {
  const map = new Map<string, ReturnType<typeof parseUserDeletionMetadata>>();
  if (deletedUserIds.length === 0) return map;

  const db = getDb();
  const rows = await db
    .select({
      entityId: schema.auditLogs.entityId,
      metadata: schema.auditLogs.metadata,
      createdAt: schema.auditLogs.createdAt,
    })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.action, "user.deleted"),
        eq(schema.auditLogs.entityType, "user"),
        inArray(schema.auditLogs.entityId, deletedUserIds),
      ),
    )
    .orderBy(desc(schema.auditLogs.createdAt));

  for (const row of rows) {
    if (!row.entityId || map.has(row.entityId)) continue;
    map.set(row.entityId, parseUserDeletionMetadata(row.metadata));
  }

  return map;
}
