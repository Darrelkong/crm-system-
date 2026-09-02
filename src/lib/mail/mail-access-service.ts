import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { MailUserAccess } from "../../../drizzle/schema/mail-user-access";
import { buildInsertAuditLogSelectStatement } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import { runMailBatch } from "@/lib/mail/guarded-batch";
import { findActiveVerifiedNotificationIdentity } from "@/lib/mail/notification-identity-service";
import { assertMailPermissionManagement } from "@/lib/permissions/mail";

export type MailAccessAdminView = MailUserAccess & {
  hasVerifiedNotificationIdentity: boolean;
};

function buildMailAccessAuditInsert(
  db: Database,
  actor: MailActorContext,
  input: {
    auditId: string;
    now: string;
    action: string;
    targetUserId: string;
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
        ${"mail_user_access"} AS entity_type,
        ${input.targetUserId} AS entity_id,
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
  return user;
}

async function getMailAccessRow(
  db: Database,
  targetUserId: string,
): Promise<MailUserAccess | null> {
  const [row] = await db
    .select()
    .from(schema.mailUserAccess)
    .where(eq(schema.mailUserAccess.userId, targetUserId))
    .limit(1);
  return row ?? null;
}

async function toAdminView(
  db: Database,
  row: MailUserAccess,
): Promise<MailAccessAdminView> {
  const verified = await findActiveVerifiedNotificationIdentity(
    db,
    row.userId,
  );
  return {
    ...row,
    hasVerifiedNotificationIdentity: verified !== null,
  };
}

export async function getMailAccessForAdmin(
  db: Database,
  actor: MailActorContext,
  targetUserId: string,
): Promise<MailAccessAdminView> {
  assertMailPermissionManagement(actor);
  await requireTargetUser(db, targetUserId);
  const row = await getMailAccessRow(db, targetUserId);
  if (!row) {
    throw MailServiceError.notFound("Mail access record not found");
  }
  return toAdminView(db, row);
}

export async function listMailAccessForAdmin(
  db: Database,
  actor: MailActorContext,
): Promise<MailAccessAdminView[]> {
  assertMailPermissionManagement(actor);
  const rows = await db.select().from(schema.mailUserAccess);
  const results: MailAccessAdminView[] = [];
  for (const row of rows) {
    results.push(await toAdminView(db, row));
  }
  return results;
}

export async function prepareMailAccess(
  db: Database,
  actor: MailActorContext,
  targetUserId: string,
): Promise<MailAccessAdminView> {
  assertMailPermissionManagement(actor);
  await requireTargetUser(db, targetUserId);

  const existing = await getMailAccessRow(db, targetUserId);
  if (existing) {
    return toAdminView(db, existing);
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  await runMailBatch(db, [
    db.insert(schema.mailUserAccess).values({
      userId: targetUserId,
      isEnabled: 0,
      createdAt: now,
      updatedAt: now,
    }),
    buildMailAccessAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.accessPrepared,
      targetUserId,
      metadata: {
        targetUserId,
        actorUserId: actor.userId,
      },
    }),
  ]);

  const row = await getMailAccessRow(db, targetUserId);
  if (!row) {
    throw MailServiceError.integrityConflict("Mail access preparation failed");
  }
  return toAdminView(db, row);
}

export async function enableMailAccess(
  db: Database,
  actor: MailActorContext,
  targetUserId: string,
): Promise<MailAccessAdminView> {
  assertMailPermissionManagement(actor);
  await requireTargetUser(db, targetUserId);

  const verifiedIdentity = await findActiveVerifiedNotificationIdentity(
    db,
    targetUserId,
  );

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const existing = await getMailAccessRow(db, targetUserId);

  const statements = existing
    ? [
        db
          .update(schema.mailUserAccess)
          .set({
            isEnabled: 1,
            enabledAt: now,
            enabledBy: actor.userId,
            disabledAt: null,
            updatedAt: now,
          })
          .where(eq(schema.mailUserAccess.userId, targetUserId)),
        buildMailAccessAuditInsert(db, actor, {
          auditId,
          now,
          action: MAIL_AUDIT_ACTIONS.accessEnabled,
          targetUserId,
          metadata: {
            targetUserId,
            notificationIdentityId: verifiedIdentity?.id ?? null,
            actorUserId: actor.userId,
          },
        }),
      ]
    : [
        db.insert(schema.mailUserAccess).values({
          userId: targetUserId,
          isEnabled: 1,
          enabledAt: now,
          enabledBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        }),
        buildMailAccessAuditInsert(db, actor, {
          auditId,
          now,
          action: MAIL_AUDIT_ACTIONS.accessEnabled,
          targetUserId,
          metadata: {
            targetUserId,
            notificationIdentityId: verifiedIdentity?.id ?? null,
            actorUserId: actor.userId,
          },
        }),
      ];

  await runMailBatch(db, statements);

  const row = await getMailAccessRow(db, targetUserId);
  if (!row || row.isEnabled !== 1) {
    throw MailServiceError.integrityConflict("Mail access enable failed");
  }
  return toAdminView(db, row);
}

export async function disableMailAccess(
  db: Database,
  actor: MailActorContext,
  targetUserId: string,
): Promise<MailAccessAdminView> {
  assertMailPermissionManagement(actor);
  await requireTargetUser(db, targetUserId);

  const existing = await getMailAccessRow(db, targetUserId);
  if (!existing) {
    throw MailServiceError.notFound("Mail access record not found");
  }
  if (existing.isEnabled === 0) {
    return toAdminView(db, existing);
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  await runMailBatch(db, [
    db
      .update(schema.mailUserAccess)
      .set({
        isEnabled: 0,
        disabledAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailUserAccess.userId, targetUserId),
          eq(schema.mailUserAccess.isEnabled, 1),
        ),
      ),
    buildMailAccessAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.accessDisabled,
      targetUserId,
      metadata: {
        targetUserId,
        actorUserId: actor.userId,
      },
    }),
  ]);

  const row = await getMailAccessRow(db, targetUserId);
  if (!row || row.isEnabled !== 0) {
    throw MailServiceError.integrityConflict("Mail access disable failed");
  }
  return toAdminView(db, row);
}

/**
 * Disables Mail access when enabled. Caller must enforce authorization.
 * Returns whether access was disabled in this call.
 */
export async function disableMailAccessIfEnabled(
  db: Database,
  actor: MailActorContext,
  targetUserId: string,
  input?: {
    auditAction?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  await requireTargetUser(db, targetUserId);

  const existing = await getMailAccessRow(db, targetUserId);
  if (!existing || existing.isEnabled === 0) {
    return false;
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  await runMailBatch(db, [
    db
      .update(schema.mailUserAccess)
      .set({
        isEnabled: 0,
        disabledAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailUserAccess.userId, targetUserId),
          eq(schema.mailUserAccess.isEnabled, 1),
        ),
      ),
    buildMailAccessAuditInsert(db, actor, {
      auditId,
      now,
      action: input?.auditAction ?? MAIL_AUDIT_ACTIONS.accessDisabled,
      targetUserId,
      metadata: {
        targetUserId,
        actorUserId: actor.userId,
        ...input?.metadata,
      },
    }),
  ]);

  const row = await getMailAccessRow(db, targetUserId);
  if (!row || row.isEnabled !== 0) {
    throw MailServiceError.integrityConflict("Mail access disable failed");
  }
  return true;
}
