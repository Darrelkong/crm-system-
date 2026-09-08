import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import {
  KNOWLEDGE_ERROR_CODES,
  KNOWLEDGE_ROLE_RANK,
  type KnowledgeCapability,
} from "@/lib/knowledge/constants";
import { buildKnowledgeAuditInsert } from "@/lib/knowledge/audit";
import { countKnowledgeAdmins } from "@/lib/knowledge/access-policy-service";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import type {
  KnowledgeRole,
} from "../../../drizzle/schema/knowledge-user-roles";
import type { User } from "../../../drizzle/schema/users";

export function isKnowledgeRole(value: string): value is KnowledgeRole {
  return (
    value === "viewer" ||
    value === "contributor" ||
    value === "reviewer" ||
    value === "knowledge_admin"
  );
}

export function hasKnowledgeRoleAtLeast(
  role: KnowledgeRole,
  minimum: KnowledgeRole,
): boolean {
  return KNOWLEDGE_ROLE_RANK[role] >= KNOWLEDGE_ROLE_RANK[minimum];
}

export function hasKnowledgeCapability(
  role: KnowledgeRole,
  capability: KnowledgeCapability,
): boolean {
  if (capability === "enter") return true;
  if (capability === "submit") return hasKnowledgeRoleAtLeast(role, "contributor");
  if (capability === "review") return hasKnowledgeRoleAtLeast(role, "reviewer");
  return role === "knowledge_admin";
}

export async function getKnowledgeRole(
  userId: string,
  db: Database = getDb(),
): Promise<KnowledgeRole | null> {
  const rows = await db
    .select({ role: schema.knowledgeUserRoles.role })
    .from(schema.knowledgeUserRoles)
    .where(eq(schema.knowledgeUserRoles.userId, userId))
    .limit(1);
  const role = rows[0]?.role;
  return role && isKnowledgeRole(role) ? role : null;
}

export async function listKnowledgeUsers(
  db: Database = getDb(),
): Promise<
  Array<{
    id: string;
    email: string;
    displayName: string;
    role: KnowledgeRole | null;
  }>
> {
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.knowledgeUserRoles.role,
    })
    .from(schema.users)
    .leftJoin(
      schema.knowledgeUserRoles,
      eq(schema.knowledgeUserRoles.userId, schema.users.id),
    )
    .where(
      and(eq(schema.users.isActive, 1), isNull(schema.users.deletedAt)),
    )
    .orderBy(sql`lower(${schema.users.displayName})`);

  return rows.map((row) => ({
    ...row,
    role: row.role && isKnowledgeRole(row.role) ? row.role : null,
  }));
}

export async function setKnowledgeRole(
  actor: User,
  targetUserId: string,
  nextRole: string,
  meta: { ipAddress?: string | null; userAgent?: string | null },
  db: Database = getDb(),
): Promise<KnowledgeRole> {
  if (!isKnowledgeRole(nextRole)) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ROLE_INVALID,
      "Knowledge 角色无效",
      400,
    );
  }

  const targetRows = await db
    .select({
      id: schema.users.id,
      isActive: schema.users.isActive,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, targetUserId))
    .limit(1);
  const target = targetRows[0];
  if (!target || target.isActive !== 1 || target.deletedAt != null) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.ROLE_INVALID,
      "目标用户不可用于 Knowledge 角色",
      400,
    );
  }

  const currentRole = await getKnowledgeRole(targetUserId, db);
  if (currentRole === nextRole) return nextRole;
  if (
    currentRole === "knowledge_admin" &&
    nextRole !== "knowledge_admin" &&
    (await countKnowledgeAdmins(db)) <= 1
  ) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.LAST_ADMIN,
      "不能移除最后一位 Knowledge Admin",
      409,
    );
  }

  const now = new Date().toISOString();
  await db.batch([
    db
      .insert(schema.knowledgeUserRoles)
      .values({
        userId: targetUserId,
        role: nextRole,
        createdBy: actor.id,
        createdAt: now,
        updatedBy: actor.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.knowledgeUserRoles.userId,
        set: {
          role: nextRole,
          updatedBy: actor.id,
          updatedAt: now,
        },
      }),
    buildKnowledgeAuditInsert(db, {
      userId: actor.id,
      action: "knowledge.role_change",
      entityType: "knowledge_user_role",
      entityId: targetUserId,
      ...meta,
      metadata: {
        previousRole: currentRole,
        nextRole,
      },
    }),
  ]);

  return nextRole;
}
