import { eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import {
  KNOWLEDGE_ERROR_CODES,
  KNOWLEDGE_POLICY_ID,
} from "@/lib/knowledge/constants";
import {
  buildKnowledgeAuditInsert,
  type KnowledgeAuditInput,
} from "@/lib/knowledge/audit";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import type { User } from "../../../drizzle/schema/users";

export type KnowledgeRequestMeta = Pick<
  KnowledgeAuditInput,
  "ipAddress" | "userAgent"
>;

export async function getKnowledgePolicy(
  db: Database = getDb(),
): Promise<typeof schema.knowledgeAccessPolicy.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.knowledgeAccessPolicy)
    .where(eq(schema.knowledgeAccessPolicy.id, KNOWLEDGE_POLICY_ID))
    .limit(1);
  return rows[0] ?? null;
}

export async function countKnowledgeAdmins(
  db: Database = getDb(),
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.knowledgeUserRoles)
    .where(eq(schema.knowledgeUserRoles.role, "knowledge_admin"));
  return Number(rows[0]?.count ?? 0);
}

function assertKnowledgePassword(password: string): void {
  const validation = validatePasswordPolicy(password);
  if (!validation.valid) {
    throw new KnowledgeServiceError(
      validation.code ?? KNOWLEDGE_ERROR_CODES.PASSWORD_INVALID,
      validation.message ?? "Knowledge 密码不符合要求",
      400,
    );
  }
}

export async function bootstrapKnowledge(
  actor: User,
  password: string,
  sessionId: string,
  meta: KnowledgeRequestMeta,
  db: Database = getDb(),
): Promise<void> {
  if (actor.role !== "admin") {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ADMIN_REQUIRED,
      "需要 CRM 管理员权限",
      403,
    );
  }
  assertKnowledgePassword(password);

  const existingPolicy = await getKnowledgePolicy(db);
  if (existingPolicy || (await countKnowledgeAdmins(db)) > 0) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ALREADY_INITIALIZED,
      "Knowledge 已完成初始化",
      409,
    );
  }

  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const audit: KnowledgeAuditInput = {
    userId: actor.id,
    action: "knowledge.bootstrap",
    entityType: "knowledge_access_policy",
    entityId: KNOWLEDGE_POLICY_ID,
    ...meta,
    metadata: { passwordVersion: 1 },
  };

  try {
    await db.batch([
      db.insert(schema.knowledgeAccessPolicy).values({
        id: KNOWLEDGE_POLICY_ID,
        passwordHash,
        passwordVersion: 1,
        initializedBy: actor.id,
        createdAt: now,
        updatedBy: actor.id,
        updatedAt: now,
      }),
      db.insert(schema.knowledgeUserRoles).values({
        userId: actor.id,
        role: "knowledge_admin",
        createdBy: actor.id,
        createdAt: now,
        updatedBy: actor.id,
        updatedAt: now,
      }),
      db.insert(schema.knowledgeSessionUnlocks).values({
        sessionId,
        userId: actor.id,
        passwordVersionAtUnlock: 1,
        unlockedAt: now,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      }),
      buildKnowledgeAuditInsert(db, audit),
    ]);
  } catch {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ALREADY_INITIALIZED,
      "Knowledge 初始化竞争失败，请重新载入后再试",
      409,
    );
  }
}

export async function changeKnowledgePassword(
  actor: User,
  password: string,
  meta: KnowledgeRequestMeta,
  db: Database = getDb(),
): Promise<number> {
  assertKnowledgePassword(password);
  const policy = await getKnowledgePolicy(db);
  if (!policy) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.NOT_INITIALIZED,
      "Knowledge 尚未初始化",
      409,
    );
  }

  const passwordHash = await hashPassword(password);
  const nextVersion = policy.passwordVersion + 1;
  const now = new Date().toISOString();
  const update = db
    .update(schema.knowledgeAccessPolicy)
    .set({
      passwordHash,
      passwordVersion: nextVersion,
      updatedBy: actor.id,
      updatedAt: now,
    })
    .where(
      sql`${schema.knowledgeAccessPolicy.id} = ${KNOWLEDGE_POLICY_ID}
        AND ${schema.knowledgeAccessPolicy.passwordVersion} = ${policy.passwordVersion}`,
    );

  await db.batch([
    update,
    buildKnowledgeAuditInsert(db, {
      userId: actor.id,
      action: "knowledge.password_change",
      entityType: "knowledge_access_policy",
      entityId: KNOWLEDGE_POLICY_ID,
      ...meta,
      metadata: { passwordVersion: nextVersion },
    }),
  ]);

  const updated = await getKnowledgePolicy(db);
  if (!updated || updated.passwordVersion !== nextVersion) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ALREADY_INITIALIZED,
      "Knowledge 密码更新发生冲突，请重试",
      409,
    );
  }
  return nextVersion;
}
