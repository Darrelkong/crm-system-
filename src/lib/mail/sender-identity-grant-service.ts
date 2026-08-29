import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { MailSenderIdentityGrant } from "../../../drizzle/schema/mail-sender-identity-grants";
import { buildInsertAuditLogSelectStatement } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { assertBatchUpdateChanged, runMailBatch } from "@/lib/mail/guarded-batch";
import { MailServiceError } from "@/lib/mail/errors";
import {
  hasMailboxSendAuthorizationForUser,
  resolveOutboundComposeMailboxId,
} from "@/lib/mail/compose-authorization";
import { findSenderIdentityById } from "@/lib/mail/sender-identity-service";
import {
  toSafeSenderIdentityGrantView,
  type SafeSenderIdentityGrantView,
} from "@/lib/mail/sender-identity-serialization";
import { assertMailSenderIdentityGrantManagement } from "@/lib/permissions/mail";

function buildSenderGrantAuditInsert(
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
        ${"mail_sender_identity_grant"} AS entity_type,
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

async function assertTargetUserMailboxSendAuthorizationForCanSendGrant(
  db: Database,
  identity: Awaited<ReturnType<typeof findSenderIdentityById>> & object,
  targetUserId: string,
): Promise<void> {
  const composeMailboxId = resolveOutboundComposeMailboxId(identity);
  if (!composeMailboxId) {
    throw MailServiceError.validation(
      "Sender identity has no compose mailbox configured",
    );
  }

  const [mailbox] = await db
    .select()
    .from(schema.mailMailboxes)
    .where(eq(schema.mailMailboxes.id, composeMailboxId))
    .limit(1);
  if (!mailbox) {
    throw MailServiceError.notFound("Sender identity compose mailbox not found");
  }
  if (mailbox.status !== "active") {
    throw MailServiceError.validation(
      "Sender identity compose mailbox must be active",
    );
  }

  if (
    !(await hasMailboxSendAuthorizationForUser(db, targetUserId, mailbox))
  ) {
    throw MailServiceError.validation(
      "Target user lacks mailbox send authorization for this sender identity compose mailbox",
    );
  }
}

export async function findActiveSenderIdentityGrant(
  db: Database,
  senderIdentityId: string,
  userId: string,
): Promise<MailSenderIdentityGrant | null> {
  const [row] = await db
    .select()
    .from(schema.mailSenderIdentityGrants)
    .where(
      and(
        eq(schema.mailSenderIdentityGrants.senderIdentityId, senderIdentityId),
        eq(schema.mailSenderIdentityGrants.userId, userId),
        isNull(schema.mailSenderIdentityGrants.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listSenderIdentityGrants(
  db: Database,
  actor: MailActorContext,
  senderIdentityId: string,
): Promise<SafeSenderIdentityGrantView[]> {
  assertMailSenderIdentityGrantManagement(actor);
  const identity = await findSenderIdentityById(db, senderIdentityId);
  if (!identity) {
    throw MailServiceError.notFound("Sender identity not found");
  }
  const rows = await db
    .select()
    .from(schema.mailSenderIdentityGrants)
    .where(
      and(
        eq(schema.mailSenderIdentityGrants.senderIdentityId, senderIdentityId),
        isNull(schema.mailSenderIdentityGrants.revokedAt),
      ),
    );
  return rows.map(toSafeSenderIdentityGrantView);
}

export async function grantSenderIdentityAccess(
  db: Database,
  actor: MailActorContext,
  input: {
    senderIdentityId: string;
    targetUserId: string;
    canReply?: boolean;
    canSend?: boolean;
  },
): Promise<SafeSenderIdentityGrantView> {
  assertMailSenderIdentityGrantManagement(actor);

  const identity = await findSenderIdentityById(db, input.senderIdentityId);
  if (!identity) {
    throw MailServiceError.notFound("Sender identity not found");
  }
  if (identity.status === "deleted") {
    throw MailServiceError.conflict("Cannot grant access to deleted sender identity");
  }

  await requireTargetUser(db, input.targetUserId);

  const canReply = input.canReply === true ? 1 : 0;
  const canSend = input.canSend === true ? 1 : 0;
  if (canReply === 0 && canSend === 0) {
    throw MailServiceError.validation("canReply or canSend must be true");
  }
  if (canSend === 1) {
    await assertTargetUserMailboxSendAuthorizationForCanSendGrant(
      db,
      identity,
      input.targetUserId,
    );
  }

  const existing = await findActiveSenderIdentityGrant(
    db,
    input.senderIdentityId,
    input.targetUserId,
  );
  if (existing) {
    return toSafeSenderIdentityGrantView(existing);
  }

  const now = new Date().toISOString();
  const grantId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  try {
    await runMailBatch(db, [
      db.insert(schema.mailSenderIdentityGrants).values({
        id: grantId,
        senderIdentityId: input.senderIdentityId,
        userId: input.targetUserId,
        canReply,
        canSend,
        grantedBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      }),
      buildSenderGrantAuditInsert(db, actor, {
        auditId,
        now,
        action: MAIL_AUDIT_ACTIONS.senderGrantGranted,
        entityId: grantId,
        metadata: {
          senderIdentityId: input.senderIdentityId,
          targetUserId: input.targetUserId,
          canReply: canReply === 1,
          canSend: canSend === 1,
          actorUserId: actor.userId,
        },
      }),
    ]);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const raced = await findActiveSenderIdentityGrant(
        db,
        input.senderIdentityId,
        input.targetUserId,
      );
      if (raced) return toSafeSenderIdentityGrantView(raced);
      throw MailServiceError.conflict("Sender identity grant already exists");
    }
    throw error;
  }

  const grant = await findActiveSenderIdentityGrant(
    db,
    input.senderIdentityId,
    input.targetUserId,
  );
  if (!grant) {
    throw MailServiceError.integrityConflict("Sender identity grant creation failed");
  }
  return toSafeSenderIdentityGrantView(grant);
}

export async function revokeSenderIdentityGrant(
  db: Database,
  actor: MailActorContext,
  input: { grantId: string },
): Promise<SafeSenderIdentityGrantView> {
  assertMailSenderIdentityGrantManagement(actor);

  const [grant] = await db
    .select()
    .from(schema.mailSenderIdentityGrants)
    .where(eq(schema.mailSenderIdentityGrants.id, input.grantId))
    .limit(1);
  if (!grant) {
    throw MailServiceError.notFound("Sender identity grant not found");
  }
  if (grant.revokedAt) {
    return toSafeSenderIdentityGrantView(grant);
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailSenderIdentityGrants)
      .set({
        revokedAt: now,
        revokedBy: actor.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailSenderIdentityGrants.id, grant.id),
          isNull(schema.mailSenderIdentityGrants.revokedAt),
        ),
      ),
    buildSenderGrantAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.senderGrantRevoked,
      entityId: grant.id,
      metadata: {
        senderIdentityId: grant.senderIdentityId,
        targetUserId: grant.userId,
        actorUserId: actor.userId,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Sender identity grant revoke conflict");

  const [revoked] = await db
    .select()
    .from(schema.mailSenderIdentityGrants)
    .where(eq(schema.mailSenderIdentityGrants.id, grant.id))
    .limit(1);
  if (!revoked?.revokedAt) {
    throw MailServiceError.integrityConflict("Sender identity grant revoke failed");
  }
  return toSafeSenderIdentityGrantView(revoked);
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
