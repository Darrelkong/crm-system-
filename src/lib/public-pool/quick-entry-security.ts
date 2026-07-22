import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { writeAuditLog } from "@/lib/audit/audit-log";
import {
  isQuickEntryCodeBodyRejectable,
  validateQuickEntryCodeFormat,
} from "@/lib/public-pool/quick-entry-code";
import {
  QUICK_ENTRY_ERROR_CODES,
  QUICK_ENTRY_GRANT_DURATION_MS,
  QUICK_ENTRY_GRANT_DURATION_SECONDS,
  QUICK_ENTRY_LOCK_DURATION_MS,
  QUICK_ENTRY_LOCK_DURATION_SECONDS,
  QUICK_ENTRY_MAX_FAILED_ATTEMPTS,
} from "@/lib/public-pool/quick-entry-constants";
import {
  getQuickEntrySettingsInternal,
  type QuickEntryInternalSettings,
} from "@/lib/public-pool/quick-entry-settings";
import type { User } from "../../../drizzle/schema/users";

export type QuickEntryGrantStatus = {
  enabled: boolean;
  hasCode: boolean;
  grantActive: boolean;
  grantExpiresAt: string | null;
  locked: boolean;
  lockedUntil: string | null;
  retryAfterSeconds: number | null;
};

export type QuickEntryVerifySuccess = {
  ok: true;
  grantExpiresAt: string;
};

export class QuickEntrySecurityError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly httpStatus: number,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "QuickEntrySecurityError";
  }
}

function retryAfterSecondsFrom(lockedUntil: string, now: Date): number {
  const ms = new Date(lockedUntil).getTime() - now.getTime();
  return Math.max(1, Math.ceil(ms / 1000));
}

export function evaluateQuickEntryGrantStatus(input: {
  settings: QuickEntryInternalSettings;
  grantUntil: string | null;
  grantVersion: number | null;
  lockedUntil: string | null;
  now?: Date;
}): QuickEntryGrantStatus {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  let locked = false;
  let lockedUntil: string | null = null;
  let retryAfterSeconds: number | null = null;
  if (input.lockedUntil && input.lockedUntil > nowIso) {
    locked = true;
    lockedUntil = input.lockedUntil;
    retryAfterSeconds = retryAfterSecondsFrom(input.lockedUntil, now);
  }

  const grantExpiresAt =
    input.grantUntil && input.grantUntil > nowIso ? input.grantUntil : null;

  const grantActive =
    input.settings.enabled &&
    !locked &&
    grantExpiresAt != null &&
    input.grantVersion != null &&
    input.grantVersion === input.settings.grantVersion;

  return {
    enabled: input.settings.enabled,
    hasCode: input.settings.hasCode,
    grantActive,
    grantExpiresAt: grantActive ? grantExpiresAt : null,
    locked,
    lockedUntil,
    retryAfterSeconds,
  };
}

export async function getQuickEntryGrantStatusForSession(
  sessionId: string,
  db?: Database,
  now: Date = new Date(),
): Promise<QuickEntryGrantStatus> {
  const database = db ?? getDb();
  const settings = await getQuickEntrySettingsInternal(database);
  const rows = await database
    .select({
      grantUntil: schema.sessions.quickEntryGrantUntil,
      grantVersion: schema.sessions.quickEntryGrantVersion,
      lockedUntil: schema.sessions.quickEntryLockedUntil,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  const row = rows[0];
  return evaluateQuickEntryGrantStatus({
    settings,
    grantUntil: row?.grantUntil ?? null,
    grantVersion: row?.grantVersion ?? null,
    lockedUntil: row?.lockedUntil ?? null,
    now,
  });
}

async function clearSessionGrant(
  db: Database,
  sessionId: string,
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({
      quickEntryGrantUntil: null,
      quickEntryGrantVersion: null,
    })
    .where(eq(schema.sessions.id, sessionId));
}

/**
 * Atomically increments failed attempts (and locks on the 5th+) in one UPDATE.
 * Avoids SELECT → Client +1 → UPDATE races across concurrent verifies.
 */
async function recordFailedAttempt(
  db: Database,
  sessionId: string,
  now: Date,
): Promise<{ attempts: number; lockedUntil: string | null }> {
  const nowIso = now.toISOString();
  const lockedUntilIso = new Date(
    now.getTime() + QUICK_ENTRY_LOCK_DURATION_MS,
  ).toISOString();

  // Reset expired lock before incrementing.
  await db
    .update(schema.sessions)
    .set({
      quickEntryFailedAttempts: 0,
      quickEntryLockedUntil: null,
    })
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        sql`${schema.sessions.quickEntryLockedUntil} IS NOT NULL`,
        sql`${schema.sessions.quickEntryLockedUntil} <= ${nowIso}`,
      ),
    );

  // If still locked, do not increment (caller should have short-circuited).
  const lockedRows = await db
    .select({
      lockedUntil: schema.sessions.quickEntryLockedUntil,
      attempts: schema.sessions.quickEntryFailedAttempts,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (
    lockedRows[0]?.lockedUntil &&
    lockedRows[0].lockedUntil > nowIso
  ) {
    return {
      attempts: lockedRows[0].attempts,
      lockedUntil: lockedRows[0].lockedUntil,
    };
  }

  // Atomic increment + conditional lock using pre-update column values.
  await db
    .update(schema.sessions)
    .set({
      quickEntryFailedAttempts: sql`${schema.sessions.quickEntryFailedAttempts} + 1`,
      quickEntryGrantUntil: null,
      quickEntryGrantVersion: null,
      quickEntryLockedUntil: sql`CASE WHEN ${schema.sessions.quickEntryFailedAttempts} + 1 >= ${QUICK_ENTRY_MAX_FAILED_ATTEMPTS} THEN ${lockedUntilIso} ELSE ${schema.sessions.quickEntryLockedUntil} END`,
    })
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        sql`(${schema.sessions.quickEntryLockedUntil} IS NULL OR ${schema.sessions.quickEntryLockedUntil} <= ${nowIso})`,
      ),
    );

  const after = await db
    .select({
      attempts: schema.sessions.quickEntryFailedAttempts,
      lockedUntil: schema.sessions.quickEntryLockedUntil,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  const attempts = after[0]?.attempts ?? 0;
  const lockedUntil =
    after[0]?.lockedUntil && after[0].lockedUntil > nowIso
      ? after[0].lockedUntil
      : null;
  return { attempts, lockedUntil };
}

export async function verifyQuickEntryCode(input: {
  user: User;
  sessionId: string;
  code: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  db?: Database;
  now?: Date;
}): Promise<QuickEntryVerifySuccess> {
  const database = input.db ?? getDb();
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const settings = await getQuickEntrySettingsInternal(database);

  if (!settings.enabled) {
    throw new QuickEntrySecurityError(
      QUICK_ENTRY_ERROR_CODES.DISABLED,
      "快速录入入口未启用",
      403,
    );
  }
  if (!settings.hasCode || !settings.codeHash) {
    throw new QuickEntrySecurityError(
      QUICK_ENTRY_ERROR_CODES.CODE_NOT_CONFIGURED,
      "录入口令尚未配置",
      409,
    );
  }

  if (isQuickEntryCodeBodyRejectable(input.code)) {
    throw new QuickEntrySecurityError(
      QUICK_ENTRY_ERROR_CODES.CODE_INVALID_FORMAT,
      "请求无效",
      400,
    );
  }

  const sessionRows = await database
    .select({
      lockedUntil: schema.sessions.quickEntryLockedUntil,
      failedAttempts: schema.sessions.quickEntryFailedAttempts,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, input.sessionId))
    .limit(1);

  const sessionRow = sessionRows[0];
  if (!sessionRow) {
    throw new QuickEntrySecurityError(
      "SESSION_INVALID",
      "会话无效",
      401,
    );
  }

  if (sessionRow.lockedUntil && sessionRow.lockedUntil > nowIso) {
    const retryAfterSeconds = retryAfterSecondsFrom(sessionRow.lockedUntil, now);
    throw new QuickEntrySecurityError(
      QUICK_ENTRY_ERROR_CODES.RATE_LIMITED,
      "验证次数过多，请稍后再试",
      429,
      retryAfterSeconds,
    );
  }

  // Format-invalid strings still count as failed attempts (no format leak).
  const format = validateQuickEntryCodeFormat(input.code);
  const passwordOk = format.ok
    ? await verifyPassword(format.code, settings.codeHash)
    : false;

  if (!passwordOk) {
    const result = await recordFailedAttempt(
      database,
      input.sessionId,
      now,
    );
    const locked = result.lockedUntil != null;
    await writeAuditLog({
      userId: input.user.id,
      action: locked
        ? "public_pool.quick_entry.code_locked"
        : "public_pool.quick_entry.code_failed",
      entityType: "session",
      entityId: input.sessionId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: {
        result: "failed",
        attempt: result.attempts,
        locked,
        lockDurationSeconds: locked
          ? QUICK_ENTRY_LOCK_DURATION_SECONDS
          : undefined,
        actorRole: input.user.role,
      },
    });

    if (locked && result.lockedUntil) {
      throw new QuickEntrySecurityError(
        QUICK_ENTRY_ERROR_CODES.RATE_LIMITED,
        "验证次数过多，请稍后再试",
        429,
        retryAfterSecondsFrom(result.lockedUntil, now),
      );
    }

    throw new QuickEntrySecurityError(
      QUICK_ENTRY_ERROR_CODES.CODE_INVALID,
      "录入口令错误",
      403,
    );
  }

  const grantExpiresAt = new Date(
    now.getTime() + QUICK_ENTRY_GRANT_DURATION_MS,
  ).toISOString();

  await database
    .update(schema.sessions)
    .set({
      quickEntryGrantUntil: grantExpiresAt,
      quickEntryGrantVersion: settings.grantVersion,
      quickEntryFailedAttempts: 0,
      quickEntryLockedUntil: null,
    })
    .where(eq(schema.sessions.id, input.sessionId));

  await writeAuditLog({
    userId: input.user.id,
    action: "public_pool.quick_entry.code_verified",
    entityType: "session",
    entityId: input.sessionId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    metadata: {
      result: "success",
      grantDurationSeconds: QUICK_ENTRY_GRANT_DURATION_SECONDS,
      actorRole: input.user.role,
    },
  });

  return { ok: true, grantExpiresAt };
}

export { clearSessionGrant };
