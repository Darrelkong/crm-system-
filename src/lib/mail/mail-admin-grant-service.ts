import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { MailAdminGrant } from "../../../drizzle/schema/mail-admin-grants";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";
import { buildInsertAuditLogSelectStatement } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import { assertBatchUpdateChanged, runMailBatch } from "@/lib/mail/guarded-batch";
import {
  assertMailPermissionManagement,
  assertSuperAdminGrantManagement,
  hasMailAdminGrant,
} from "@/lib/permissions/mail";

function buildAdminGrantAuditInsert(
  db: Database,
  actor: MailActorContext,
  input: {
    auditId: string;
    now: string;
    action: string;
    entityId: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);
  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        ${input.auditId} AS id,
        ${actor.userId} AS user_id,
        ${input.action} AS action,
        ${"mail_admin_grant"} AS entity_type,
        ${input.entityId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
    `,
  );
}

async function requireTargetUser(db: Database, targetUserId: string) {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, targetUserId))
    .limit(1);
  if (!user) {
    throw MailServiceError.notFound("Target user not found");
  }
}

export async function findActiveAdminGrant(
  db: Database,
  targetUserId: string,
  permission: MailAdminPermission,
): Promise<MailAdminGrant | null> {
  const [row] = await db
    .select()
    .from(schema.mailAdminGrants)
    .where(
      and(
        eq(schema.mailAdminGrants.userId, targetUserId),
        eq(schema.mailAdminGrants.permission, permission),
        isNull(schema.mailAdminGrants.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function countAllActiveSuperAdmins(db: Database): Promise<number> {
  const rows = await db
    .select({ id: schema.mailAdminGrants.id })
    .from(schema.mailAdminGrants)
    .where(
      and(
        eq(schema.mailAdminGrants.permission, "super_admin"),
        isNull(schema.mailAdminGrants.revokedAt),
      ),
    );
  return rows.length;
}

async function countActiveSuperAdmins(
  db: Database,
  excludeUserId?: string,
): Promise<number> {
  const rows = await db
    .select({ userId: schema.mailAdminGrants.userId })
    .from(schema.mailAdminGrants)
    .where(
      and(
        eq(schema.mailAdminGrants.permission, "super_admin"),
        isNull(schema.mailAdminGrants.revokedAt),
      ),
    );
  return rows.filter((row) => row.userId !== excludeUserId).length;
}

export async function listAdminGrantsForUser(
  db: Database,
  actor: MailActorContext,
  targetUserId: string,
): Promise<MailAdminGrant[]> {
  assertMailPermissionManagement(actor);
  await requireTargetUser(db, targetUserId);
  return db
    .select()
    .from(schema.mailAdminGrants)
    .where(
      and(
        eq(schema.mailAdminGrants.userId, targetUserId),
        isNull(schema.mailAdminGrants.revokedAt),
      ),
    );
}

export async function grantMailAdminPermission(
  db: Database,
  actor: MailActorContext,
  input: { targetUserId: string; permission: MailAdminPermission },
): Promise<MailAdminGrant> {
  assertMailPermissionManagement(actor);
  await requireTargetUser(db, input.targetUserId);

  if (input.permission === "super_admin") {
    assertSuperAdminGrantManagement(actor);
    const activeSuperAdminCount = await countAllActiveSuperAdmins(db);
    if (activeSuperAdminCount === 0) {
      throw MailServiceError.forbidden(
        "First super_admin requires controlled deployment bootstrap",
      );
    }
  }

  const existing = await findActiveAdminGrant(
    db,
    input.targetUserId,
    input.permission,
  );
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const grantId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  try {
    await runMailBatch(db, [
      db.insert(schema.mailAdminGrants).values({
        id: grantId,
        userId: input.targetUserId,
        permission: input.permission,
        grantedBy: actor.userId,
        grantedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
      buildAdminGrantAuditInsert(db, actor, {
        auditId,
        now,
        action: MAIL_AUDIT_ACTIONS.adminGrantGranted,
        entityId: grantId,
        metadata: {
          targetUserId: input.targetUserId,
          permission: input.permission,
          actorUserId: actor.userId,
        },
      }),
    ]);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const raced = await findActiveAdminGrant(
        db,
        input.targetUserId,
        input.permission,
      );
      if (raced) return raced;
      throw MailServiceError.conflict("Grant already exists");
    }
    throw error;
  }

  const grant = await findActiveAdminGrant(
    db,
    input.targetUserId,
    input.permission,
  );
  if (!grant) {
    throw MailServiceError.integrityConflict("Grant creation failed");
  }
  return grant;
}

export async function revokeMailAdminGrant(
  db: Database,
  actor: MailActorContext,
  input: { grantId: string; reason?: string },
): Promise<MailAdminGrant> {
  assertMailPermissionManagement(actor);

  const [grant] = await db
    .select()
    .from(schema.mailAdminGrants)
    .where(eq(schema.mailAdminGrants.id, input.grantId))
    .limit(1);
  if (!grant) {
    throw MailServiceError.notFound("Admin grant not found");
  }
  if (grant.revokedAt) {
    return grant;
  }

  if (grant.permission === "super_admin") {
    assertSuperAdminGrantManagement(actor);
    if (
      grant.userId === actor.userId &&
      !hasMailAdminGrant(actor, "super_admin")
    ) {
      throw MailServiceError.forbidden("Cannot revoke your own super_admin grant");
    }
    const remaining = await countActiveSuperAdmins(db, grant.userId);
    if (remaining === 0) {
      throw MailServiceError.conflict(
        "Cannot revoke the last active super_admin grant",
      );
    }
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailAdminGrants)
      .set({
        revokedAt: now,
        revokedBy: actor.userId,
        revokeReason: input.reason?.trim() || "admin_revoked",
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailAdminGrants.id, grant.id),
          isNull(schema.mailAdminGrants.revokedAt),
        ),
      ),
    buildAdminGrantAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.adminGrantRevoked,
      entityId: grant.id,
      metadata: {
        targetUserId: grant.userId,
        permission: grant.permission,
        actorUserId: actor.userId,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Admin grant revoke conflict");

  const [revoked] = await db
    .select()
    .from(schema.mailAdminGrants)
    .where(eq(schema.mailAdminGrants.id, grant.id))
    .limit(1);
  if (!revoked?.revokedAt) {
    throw MailServiceError.integrityConflict("Admin grant revoke failed");
  }
  return revoked;
}

function isUniqueConstraintError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /UNIQUE constraint failed/i.test(message);
}
