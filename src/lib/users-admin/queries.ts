import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
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
import { getEffectiveSettings } from "@/lib/settings/effective";
import {
  PUBLIC_POOL_ELIGIBILITY_ROLLOUT_AT,
  PUBLIC_POOL_FIRST_LOGIN_PROTECTION_MS,
} from "@/lib/public-pool/member-policy";
import type { User } from "../../../drizzle/schema/users";

function formatUserRow(
  user: User,
  lastLoginAt: string | null,
  recentLoginCount: number,
  failedLoginMeta: {
    lastFailedLoginAt: string | null;
    lockedAtFromLog: string | null;
  },
  deviceSummary: {
    approved: number;
    pending: number;
  },
  poolDefaults: {
    quota: number;
    cooldownHours: number;
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
  const eligibilityAt = user.firstLoginAt
    ? new Date(
        new Date(user.firstLoginAt).getTime() +
          PUBLIC_POOL_FIRST_LOGIN_PROTECTION_MS,
      ).toISOString()
    : null;
  const legacyCompatible =
    !user.firstLoginAt &&
    user.createdAt < PUBLIC_POOL_ELIGIBILITY_ROLLOUT_AT;
  const protectedByFirstLogin =
    !legacyCompatible &&
    (!eligibilityAt || new Date(eligibilityAt).getTime() > Date.now());

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
    primary_assignees_transferred_count:
      deletionMeta?.primary_assignees_transferred_count ?? null,
    collaborator_assignees_removed_count:
      deletionMeta?.collaborator_assignees_removed_count ?? null,
    last_login_at: lastLoginAt,
    recent_login_count: recentLoginCount,
    cloudflare_access_email: user.cloudflareAccessEmail,
    first_login_at: user.firstLoginAt,
    pool_claim_paused: user.poolClaimPaused === 1,
    pool_claim_quota_override: user.poolClaimQuotaOverride,
    pool_claim_cooldown_hours_override: user.poolClaimCooldownHoursOverride,
    pool_claim_effective_quota:
      user.poolClaimQuotaOverride ?? poolDefaults.quota,
    pool_claim_effective_cooldown_hours:
      user.poolClaimCooldownHoursOverride ?? poolDefaults.cooldownHours,
    pool_claim_eligibility_at: eligibilityAt,
    pool_claim_remaining_days: protectedByFirstLogin
      ? Math.max(
          1,
          Math.ceil(
            ((eligibilityAt
              ? new Date(eligibilityAt).getTime()
              : Date.now() + PUBLIC_POOL_FIRST_LOGIN_PROTECTION_MS) -
              Date.now()) /
              (24 * 60 * 60 * 1000),
          ),
        )
      : 0,
    pool_claim_eligibility_status: user.poolClaimPaused
      ? "paused"
      : protectedByFirstLogin
        ? "protected"
        : "eligible",
    device_approved_count: deviceSummary.approved,
    device_pending_count: deviceSummary.pending,
  };
}

export async function listUsersForAdmin(): Promise<AdminUserView[]> {
  const db = getDb();
  const [users, settings] = await Promise.all([
    db
      .select()
      .from(schema.users)
      .orderBy(asc(schema.users.email)),
    getEffectiveSettings(db),
  ]);

  const deviceRows = await db
    .select({
      userId: schema.authorizedDevices.userId,
      status: schema.authorizedDevices.status,
      count: sql<number>`count(*)`,
    })
    .from(schema.authorizedDevices)
    .groupBy(
      schema.authorizedDevices.userId,
      schema.authorizedDevices.status,
    );
  const deviceSummaryByUser = new Map<
    string,
    { approved: number; pending: number }
  >();
  for (const row of deviceRows) {
    const summary = deviceSummaryByUser.get(row.userId) ?? {
      approved: 0,
      pending: 0,
    };
    if (row.status === "approved") summary.approved = Number(row.count);
    if (row.status === "pending") summary.pending = Number(row.count);
    deviceSummaryByUser.set(row.userId, summary);
  }

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
      deviceSummaryByUser.get(user.id) ?? { approved: 0, pending: 0 },
      {
        quota: settings.publicPoolClaimQuota7Days,
        cooldownHours: settings.publicPoolClaimCooldownHours,
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
