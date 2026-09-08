import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import {
  KNOWLEDGE_ERROR_CODES,
  KNOWLEDGE_LOCK_DURATION_MS,
  KNOWLEDGE_MAX_FAILED_ATTEMPTS,
} from "@/lib/knowledge/constants";
import { buildKnowledgeAuditInsert } from "@/lib/knowledge/audit";
import {
  getKnowledgePolicy,
  type KnowledgeRequestMeta,
} from "@/lib/knowledge/access-policy-service";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";

export type KnowledgeAccessStatus = {
  initialized: boolean;
  role: KnowledgeRole | null;
  unlocked: boolean;
  lockedUntil: string | null;
  retryAfterSeconds: number | null;
};

function retryAfterSeconds(lockedUntil: string, now: Date): number {
  return Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - now.getTime()) / 1000));
}

async function ensureUnlockRow(
  sessionId: string,
  userId: string,
  db: Database,
  nowIso: string,
): Promise<void> {
  await db
    .insert(schema.knowledgeSessionUnlocks)
    .values({
      sessionId,
      userId,
      passwordVersionAtUnlock: null,
      unlockedAt: null,
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: nowIso,
    })
    .onConflictDoNothing();
}

export async function getKnowledgeAccessStatus(
  sessionId: string,
  userId: string,
  role: KnowledgeRole | null,
  db: Database = getDb(),
  now = new Date(),
): Promise<KnowledgeAccessStatus> {
  const policy = await getKnowledgePolicy(db);
  if (!policy) {
    return {
      initialized: false,
      role: null,
      unlocked: false,
      lockedUntil: null,
      retryAfterSeconds: null,
    };
  }

  const rows = await db
    .select()
    .from(schema.knowledgeSessionUnlocks)
    .where(eq(schema.knowledgeSessionUnlocks.sessionId, sessionId))
    .limit(1);
  const unlock = rows[0];
  const nowIso = now.toISOString();
  const locked =
    unlock?.lockedUntil != null && unlock.lockedUntil > nowIso;
  const unlocked =
    role != null &&
    unlock?.userId === userId &&
    unlock.passwordVersionAtUnlock === policy.passwordVersion &&
    unlock.unlockedAt != null &&
    !locked;

  return {
    initialized: true,
    role,
    unlocked,
    lockedUntil: locked ? unlock.lockedUntil : null,
    retryAfterSeconds:
      locked && unlock.lockedUntil
        ? retryAfterSeconds(unlock.lockedUntil, now)
        : null,
  };
}

export async function assertKnowledgeAccess(
  sessionId: string,
  userId: string,
  role: KnowledgeRole | null,
  db: Database = getDb(),
): Promise<void> {
  const status = await getKnowledgeAccessStatus(sessionId, userId, role, db);
  if (!status.initialized) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.NOT_INITIALIZED,
      "Knowledge 尚未初始化",
      409,
    );
  }
  if (status.lockedUntil) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.PASSWORD_LOCKED,
      "Knowledge 验证暂时锁定，请稍后再试",
      429,
    );
  }
  if (!status.role) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ROLE_REQUIRED,
      "尚未配置 Knowledge 权限",
      403,
    );
  }
  if (!status.unlocked) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ACCESS_REQUIRED,
      "请先完成 Knowledge 二次验证",
      403,
    );
  }
}

export async function verifyKnowledgePassword(
  sessionId: string,
  userId: string,
  role: KnowledgeRole | null,
  password: string,
  meta: KnowledgeRequestMeta,
  db: Database = getDb(),
  now = new Date(),
): Promise<void> {
  const policy = await getKnowledgePolicy(db);
  if (!policy) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.NOT_INITIALIZED,
      "Knowledge 尚未初始化",
      409,
    );
  }
  if (!role) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ROLE_REQUIRED,
      "尚未配置 Knowledge 权限",
      403,
    );
  }

  const nowIso = now.toISOString();
  await ensureUnlockRow(sessionId, userId, db, nowIso);
  const rows = await db
    .select()
    .from(schema.knowledgeSessionUnlocks)
    .where(eq(schema.knowledgeSessionUnlocks.sessionId, sessionId))
    .limit(1);
  const current = rows[0];
  if (!current || current.userId !== userId) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ACCESS_REQUIRED,
      "Knowledge 会话无效",
      403,
    );
  }

  if (current.lockedUntil && current.lockedUntil > nowIso) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.PASSWORD_LOCKED,
      "Knowledge 验证暂时锁定，请稍后再试",
      429,
    );
  }

  const passwordOk = await verifyPassword(password, policy.passwordHash);
  if (!passwordOk) {
    const previousAttempts =
      current.lockedUntil && current.lockedUntil <= nowIso
        ? 0
        : current.failedAttempts;
    const failedAttempts = Math.min(
      KNOWLEDGE_MAX_FAILED_ATTEMPTS,
      previousAttempts + 1,
    );
    const lockedUntil =
      failedAttempts >= KNOWLEDGE_MAX_FAILED_ATTEMPTS
        ? new Date(now.getTime() + KNOWLEDGE_LOCK_DURATION_MS).toISOString()
        : null;

    await db.batch([
      db
        .update(schema.knowledgeSessionUnlocks)
        .set({
          failedAttempts,
          lockedUntil,
          passwordVersionAtUnlock: null,
          unlockedAt: null,
          updatedAt: nowIso,
        })
        .where(
          and(
            eq(schema.knowledgeSessionUnlocks.sessionId, sessionId),
            eq(
              schema.knowledgeSessionUnlocks.failedAttempts,
              current.failedAttempts,
            ),
          ),
        ),
      buildKnowledgeAuditInsert(db, {
        userId,
        action: "knowledge.unlock_failed",
        entityType: "knowledge_session_unlock",
        entityId: sessionId,
        ...meta,
        metadata: {
          attempt: failedAttempts,
          locked: lockedUntil != null,
        },
      }),
    ]);

    if (lockedUntil) {
      throw new KnowledgeServiceError(
        KNOWLEDGE_ERROR_CODES.PASSWORD_LOCKED,
        "验证失败次数过多，请 15 分钟后再试",
        429,
      );
    }
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.PASSWORD_INVALID,
      "Knowledge 密码错误",
      403,
    );
  }

  await db.batch([
    db
      .update(schema.knowledgeSessionUnlocks)
      .set({
        userId,
        passwordVersionAtUnlock: policy.passwordVersion,
        unlockedAt: nowIso,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: nowIso,
      })
      .where(eq(schema.knowledgeSessionUnlocks.sessionId, sessionId)),
    buildKnowledgeAuditInsert(db, {
      userId,
      action: "knowledge.unlock_success",
      entityType: "knowledge_session_unlock",
      entityId: sessionId,
      ...meta,
      metadata: { passwordVersion: policy.passwordVersion },
    }),
  ]);
}

export async function lockKnowledgeSession(
  sessionId: string,
  userId: string,
  meta: KnowledgeRequestMeta,
  db: Database = getDb(),
): Promise<void> {
  const nowIso = new Date().toISOString();
  await ensureUnlockRow(sessionId, userId, db, nowIso);
  await db.batch([
    db
      .update(schema.knowledgeSessionUnlocks)
      .set({
        passwordVersionAtUnlock: null,
        unlockedAt: null,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(schema.knowledgeSessionUnlocks.sessionId, sessionId),
          eq(schema.knowledgeSessionUnlocks.userId, userId),
        ),
      ),
    buildKnowledgeAuditInsert(db, {
      userId,
      action: "knowledge.lock",
      entityType: "knowledge_session_unlock",
      entityId: sessionId,
      ...meta,
    }),
  ]);
}
