import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { MailMailboxMember } from "../../../drizzle/schema/mail-mailbox-members";
import { buildInsertAuditLogSelectStatement } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { assertBatchUpdateChanged, runMailBatch } from "@/lib/mail/guarded-batch";
import { MailServiceError } from "@/lib/mail/errors";
import { findMailboxById } from "@/lib/mail/mailbox-service";
import {
  toSafeMailboxMemberView,
  type SafeMailboxMemberView,
} from "@/lib/mail/mailbox-member-serialization";
import { assertMailAccountManagement } from "@/lib/permissions/mail";

type MemberPermissionInput = {
  canRead?: boolean;
  canReply?: boolean;
  canSend?: boolean;
  canAssign?: boolean;
  canManageProcessing?: boolean;
  canAddInternalNote?: boolean;
};

function buildMailboxMemberAuditInsert(
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
        ${"mail_mailbox_member"} AS entity_type,
        ${input.entityId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
    `,
  );
}

function normalizePermissionFlags(input: MemberPermissionInput): {
  canRead: 0 | 1;
  canReply: 0 | 1;
  canSend: 0 | 1;
  canAssign: 0 | 1;
  canManageProcessing: 0 | 1;
  canAddInternalNote: 0 | 1;
} {
  return {
    canRead: input.canRead === true ? 1 : 0,
    canReply: input.canReply === true ? 1 : 0,
    canSend: input.canSend === true ? 1 : 0,
    canAssign: input.canAssign === true ? 1 : 0,
    canManageProcessing: input.canManageProcessing === true ? 1 : 0,
    canAddInternalNote: input.canAddInternalNote === true ? 1 : 0,
  };
}

function assertAtLeastOnePermission(flags: ReturnType<typeof normalizePermissionFlags>): void {
  if (
    flags.canRead === 0 &&
    flags.canReply === 0 &&
    flags.canSend === 0 &&
    flags.canAssign === 0 &&
    flags.canManageProcessing === 0 &&
    flags.canAddInternalNote === 0
  ) {
    throw MailServiceError.validation("At least one mailbox permission must be enabled");
  }
}

async function requireTargetUser(db: Database, targetUserId: string): Promise<void> {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, targetUserId))
    .limit(1);
  if (!user) {
    throw MailServiceError.notFound("Target user not found");
  }
}

async function requireSharedMailboxForMemberManagement(
  db: Database,
  mailboxId: string,
) {
  const mailbox = await findMailboxById(db, mailboxId);
  if (!mailbox) {
    throw MailServiceError.notFound("Mailbox not found");
  }
  if (mailbox.mailboxType !== "shared") {
    throw MailServiceError.validation(
      "Only shared mailboxes support member management",
    );
  }
  if (mailbox.status === "deleted") {
    throw MailServiceError.conflict("Cannot manage members of deleted mailbox");
  }
  return mailbox;
}

export async function findActiveMailboxMember(
  db: Database,
  mailboxId: string,
  userId: string,
): Promise<MailMailboxMember | null> {
  const [row] = await db
    .select()
    .from(schema.mailMailboxMembers)
    .where(
      and(
        eq(schema.mailMailboxMembers.mailboxId, mailboxId),
        eq(schema.mailMailboxMembers.userId, userId),
        isNull(schema.mailMailboxMembers.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listMailboxMembers(
  db: Database,
  actor: MailActorContext,
  mailboxId: string,
): Promise<SafeMailboxMemberView[]> {
  assertMailAccountManagement(actor);
  await requireSharedMailboxForMemberManagement(db, mailboxId);

  const rows = await db
    .select()
    .from(schema.mailMailboxMembers)
    .where(
      and(
        eq(schema.mailMailboxMembers.mailboxId, mailboxId),
        isNull(schema.mailMailboxMembers.revokedAt),
      ),
    );

  return rows.map(toSafeMailboxMemberView);
}

export async function grantMailboxMember(
  db: Database,
  actor: MailActorContext,
  input: {
    mailboxId: string;
    targetUserId: string;
  } & MemberPermissionInput,
): Promise<SafeMailboxMemberView> {
  assertMailAccountManagement(actor);
  await requireSharedMailboxForMemberManagement(db, input.mailboxId);
  await requireTargetUser(db, input.targetUserId);

  const flags = normalizePermissionFlags(input);
  assertAtLeastOnePermission(flags);

  const existing = await findActiveMailboxMember(
    db,
    input.mailboxId,
    input.targetUserId,
  );
  if (existing) {
    return toSafeMailboxMemberView(existing);
  }

  const now = new Date().toISOString();
  const memberId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  try {
    await runMailBatch(db, [
      db.insert(schema.mailMailboxMembers).values({
        id: memberId,
        mailboxId: input.mailboxId,
        userId: input.targetUserId,
        ...flags,
        grantedBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      }),
      buildMailboxMemberAuditInsert(db, actor, {
        auditId,
        now,
        action: MAIL_AUDIT_ACTIONS.mailboxMemberGranted,
        entityId: memberId,
        metadata: {
          mailboxId: input.mailboxId,
          targetUserId: input.targetUserId,
          ...flagsToMetadata(flags),
          actorUserId: actor.userId,
        },
      }),
    ]);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const raced = await findActiveMailboxMember(
        db,
        input.mailboxId,
        input.targetUserId,
      );
      if (raced) {
        return toSafeMailboxMemberView(raced);
      }
      throw MailServiceError.conflict("Mailbox member already exists");
    }
    throw error;
  }

  const member = await findActiveMailboxMember(
    db,
    input.mailboxId,
    input.targetUserId,
  );
  if (!member) {
    throw MailServiceError.integrityConflict("Mailbox member creation failed");
  }
  return toSafeMailboxMemberView(member);
}

export async function updateMailboxMemberPermissions(
  db: Database,
  actor: MailActorContext,
  input: { memberId: string } & MemberPermissionInput,
): Promise<SafeMailboxMemberView> {
  assertMailAccountManagement(actor);

  const [member] = await db
    .select()
    .from(schema.mailMailboxMembers)
    .where(eq(schema.mailMailboxMembers.id, input.memberId))
    .limit(1);
  if (!member) {
    throw MailServiceError.notFound("Mailbox member not found");
  }
  if (member.revokedAt) {
    throw MailServiceError.conflict("Cannot update revoked mailbox member");
  }

  await requireSharedMailboxForMemberManagement(db, member.mailboxId);

  const flags = normalizePermissionFlags({
    canRead: input.canRead ?? member.canRead === 1,
    canReply: input.canReply ?? member.canReply === 1,
    canSend: input.canSend ?? member.canSend === 1,
    canAssign: input.canAssign ?? member.canAssign === 1,
    canManageProcessing:
      input.canManageProcessing ?? member.canManageProcessing === 1,
    canAddInternalNote:
      input.canAddInternalNote ?? member.canAddInternalNote === 1,
  });
  assertAtLeastOnePermission(flags);

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailMailboxMembers)
      .set({
        ...flags,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailMailboxMembers.id, member.id),
          isNull(schema.mailMailboxMembers.revokedAt),
        ),
      ),
    buildMailboxMemberAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.mailboxMemberUpdated,
      entityId: member.id,
      metadata: {
        mailboxId: member.mailboxId,
        targetUserId: member.userId,
        ...flagsToMetadata(flags),
        actorUserId: actor.userId,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Mailbox member update conflict");

  const [updated] = await db
    .select()
    .from(schema.mailMailboxMembers)
    .where(eq(schema.mailMailboxMembers.id, member.id))
    .limit(1);
  if (!updated) {
    throw MailServiceError.integrityConflict("Mailbox member update failed");
  }
  return toSafeMailboxMemberView(updated);
}

export async function revokeMailboxMember(
  db: Database,
  actor: MailActorContext,
  input: { memberId: string },
): Promise<SafeMailboxMemberView> {
  assertMailAccountManagement(actor);

  const [member] = await db
    .select()
    .from(schema.mailMailboxMembers)
    .where(eq(schema.mailMailboxMembers.id, input.memberId))
    .limit(1);
  if (!member) {
    throw MailServiceError.notFound("Mailbox member not found");
  }
  if (member.revokedAt) {
    return toSafeMailboxMemberView(member);
  }

  await requireSharedMailboxForMemberManagement(db, member.mailboxId);

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailMailboxMembers)
      .set({
        revokedAt: now,
        revokedBy: actor.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailMailboxMembers.id, member.id),
          isNull(schema.mailMailboxMembers.revokedAt),
        ),
      ),
    buildMailboxMemberAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.mailboxMemberRevoked,
      entityId: member.id,
      metadata: {
        mailboxId: member.mailboxId,
        targetUserId: member.userId,
        actorUserId: actor.userId,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Mailbox member revoke conflict");

  const [revoked] = await db
    .select()
    .from(schema.mailMailboxMembers)
    .where(eq(schema.mailMailboxMembers.id, member.id))
    .limit(1);
  if (!revoked?.revokedAt) {
    throw MailServiceError.integrityConflict("Mailbox member revoke failed");
  }
  return toSafeMailboxMemberView(revoked);
}

function flagsToMetadata(flags: ReturnType<typeof normalizePermissionFlags>) {
  return {
    canRead: flags.canRead === 1,
    canReply: flags.canReply === 1,
    canSend: flags.canSend === 1,
    canAssign: flags.canAssign === 1,
    canManageProcessing: flags.canManageProcessing === 1,
    canAddInternalNote: flags.canAddInternalNote === 1,
  };
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
