import { and, asc, desc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { AdminUserView, LoginLogView } from "@/lib/users-admin/types";
import type { User } from "../../../drizzle/schema/users";

function formatUserRow(
  user: User,
  lastLoginAt: string | null,
  recentLoginCount: number,
): AdminUserView {
  const status: AdminUserView["status"] = user.deletedAt
    ? "deleted"
    : user.isActive === 1
      ? "active"
      : "disabled";

  return {
    id: user.id,
    name: user.displayName,
    email: user.email,
    role: user.role,
    status,
    failed_login_count: user.failedLoginAttempts,
    locked_until: user.lockedUntil,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    deleted_at: user.deletedAt,
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

  const lastLoginByUser = new Map<string, string>();
  const recentCountByUser = new Map<string, number>();

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

  return users.map((user) =>
    formatUserRow(
      user,
      lastLoginByUser.get(user.id) ?? null,
      recentCountByUser.get(user.id) ?? 0,
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
