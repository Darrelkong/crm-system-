import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { MailSenderIdentity } from "../../../drizzle/schema/mail-sender-identities";
import { buildInsertAuditLogSelectStatement } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  assertValidEchfrontMailAddress,
  isReservedEchfrontMailLocalPart,
  normalizeEchfrontCompanyAddress,
} from "@/lib/mail/company-mail-address";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import {
  assertBatchUpdateChanged,
  isMailPostStateGuardError,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import { MailServiceError } from "@/lib/mail/errors";
import {
  toSafeSenderIdentityAdminView,
  type SafeSenderIdentityAdminView,
} from "@/lib/mail/sender-identity-serialization";
import { assertMailSenderIdentityManagement, hasMailAdminGrant } from "@/lib/permissions/mail";

export { toSafeSenderIdentityAdminView };

function buildSenderIdentityAuditInsert(
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
        ${"mail_sender_identity"} AS entity_type,
        ${input.entityId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
    `,
  );
}

export async function findSenderIdentityById(
  db: Database,
  identityId: string,
): Promise<MailSenderIdentity | null> {
  const [row] = await db
    .select()
    .from(schema.mailSenderIdentities)
    .where(eq(schema.mailSenderIdentities.id, identityId))
    .limit(1);
  return row ?? null;
}

async function requireUsableMailbox(
  db: Database,
  mailboxId: string,
  fieldName: string,
): Promise<void> {
  const [mailbox] = await db
    .select()
    .from(schema.mailMailboxes)
    .where(eq(schema.mailMailboxes.id, mailboxId))
    .limit(1);
  if (!mailbox) {
    throw MailServiceError.notFound(`${fieldName} mailbox not found`);
  }
  if (mailbox.status !== "active") {
    throw MailServiceError.validation(
      `${fieldName} mailbox must be active`,
    );
  }
}

async function validateAliasParent(
  db: Database,
  aliasOfIdentityId: string,
  selfId?: string,
): Promise<MailSenderIdentity> {
  if (selfId && aliasOfIdentityId === selfId) {
    throw MailServiceError.validation("Sender identity cannot alias itself");
  }
  const parent = await findSenderIdentityById(db, aliasOfIdentityId);
  if (!parent) {
    throw MailServiceError.notFound("Alias parent sender identity not found");
  }
  if (parent.status === "deleted") {
    throw MailServiceError.validation("Alias parent sender identity is deleted");
  }
  if (parent.aliasOfIdentityId) {
    throw MailServiceError.validation(
      "Alias chains are not supported; parent must be a primary identity",
    );
  }
  return parent;
}

function resolveSenderIdentityAddress(
  actor: MailActorContext,
  address: string,
): string {
  const { normalized, localPart } = normalizeEchfrontCompanyAddress(address);
  if (isReservedEchfrontMailLocalPart(localPart)) {
    if (!hasMailAdminGrant(actor, "super_admin")) {
      throw MailServiceError.forbidden(
        "Reserved system sender identity requires super_admin",
      );
    }
    return normalized;
  }
  return assertValidEchfrontMailAddress(address);
}

export async function listSenderIdentitiesForAdmin(
  db: Database,
  actor: MailActorContext,
): Promise<SafeSenderIdentityAdminView[]> {
  assertMailSenderIdentityManagement(actor);
  const rows = await db.select().from(schema.mailSenderIdentities);
  return rows.map(toSafeSenderIdentityAdminView);
}

export async function getSenderIdentity(
  db: Database,
  actor: MailActorContext,
  identityId: string,
): Promise<SafeSenderIdentityAdminView> {
  assertMailSenderIdentityManagement(actor);
  const identity = await findSenderIdentityById(db, identityId);
  if (!identity) {
    throw MailServiceError.notFound("Sender identity not found");
  }
  return toSafeSenderIdentityAdminView(identity);
}

export async function createSenderIdentity(
  db: Database,
  actor: MailActorContext,
  input: {
    address: string;
    displayName?: string | null;
    defaultMailboxId?: string | null;
    sentFolderMailboxId?: string | null;
    aliasOfIdentityId?: string | null;
  },
): Promise<SafeSenderIdentityAdminView> {
  assertMailSenderIdentityManagement(actor);

  const defaultMailboxId = input.defaultMailboxId?.trim() || null;
  const sentFolderMailboxId = input.sentFolderMailboxId?.trim() || null;
  if (!defaultMailboxId && !sentFolderMailboxId) {
    throw MailServiceError.validation(
      "defaultMailboxId or sentFolderMailboxId is required",
    );
  }

  const normalizedAddress = resolveSenderIdentityAddress(actor, input.address);

  if (defaultMailboxId) {
    await requireUsableMailbox(db, defaultMailboxId, "defaultMailboxId");
  }
  if (sentFolderMailboxId) {
    await requireUsableMailbox(db, sentFolderMailboxId, "sentFolderMailboxId");
  }

  const aliasOfIdentityId = input.aliasOfIdentityId?.trim() || null;
  if (aliasOfIdentityId) {
    await validateAliasParent(db, aliasOfIdentityId);
  }

  const now = new Date().toISOString();
  const identityId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  try {
    await runMailBatch(db, [
      db.insert(schema.mailSenderIdentities).values({
        id: identityId,
        address: normalizedAddress,
        displayName: input.displayName?.trim() || null,
        status: "active",
        defaultMailboxId,
        sentFolderMailboxId,
        aliasOfIdentityId,
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      }),
      buildSenderIdentityAuditInsert(db, actor, {
        auditId,
        now,
        action: MAIL_AUDIT_ACTIONS.senderIdentityCreated,
        entityId: identityId,
        metadata: {
          senderIdentityId: identityId,
          address: normalizedAddress,
          aliasOfIdentityId,
          reservedSystemIdentity: isReservedEchfrontMailLocalPart(
            normalizedAddress.slice(0, normalizedAddress.lastIndexOf("@")),
          ),
          actorUserId: actor.userId,
        },
      }),
    ]);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw MailServiceError.conflict("Sender identity address is already in use");
    }
    throw error;
  }

  const identity = await findSenderIdentityById(db, identityId);
  if (!identity) {
    throw MailServiceError.integrityConflict("Sender identity creation failed");
  }
  return toSafeSenderIdentityAdminView(identity);
}

export async function suspendSenderIdentity(
  db: Database,
  actor: MailActorContext,
  identityId: string,
): Promise<SafeSenderIdentityAdminView> {
  assertMailSenderIdentityManagement(actor);

  const identity = await findSenderIdentityById(db, identityId);
  if (!identity) {
    throw MailServiceError.notFound("Sender identity not found");
  }
  if (identity.status !== "active") {
    throw MailServiceError.conflict("Sender identity must be active to suspend", {
      currentStatus: identity.status,
    });
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailSenderIdentities)
      .set({ status: "suspended", updatedAt: now })
      .where(
        and(
          eq(schema.mailSenderIdentities.id, identityId),
          eq(schema.mailSenderIdentities.status, "active"),
        ),
      ),
    buildSenderIdentityAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.senderIdentitySuspended,
      entityId: identityId,
      metadata: {
        senderIdentityId: identityId,
        previousStatus: "active",
        newStatus: "suspended",
        actorUserId: actor.userId,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Sender identity suspend conflict");

  const updated = await findSenderIdentityById(db, identityId);
  if (!updated || updated.status !== "suspended") {
    throw MailServiceError.integrityConflict("Sender identity suspend failed");
  }
  return toSafeSenderIdentityAdminView(updated);
}

export async function restoreSenderIdentity(
  db: Database,
  actor: MailActorContext,
  identityId: string,
): Promise<SafeSenderIdentityAdminView> {
  assertMailSenderIdentityManagement(actor);

  const identity = await findSenderIdentityById(db, identityId);
  if (!identity) {
    throw MailServiceError.notFound("Sender identity not found");
  }
  if (identity.status !== "suspended") {
    throw MailServiceError.conflict(
      "Sender identity must be suspended to restore",
      { currentStatus: identity.status },
    );
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailSenderIdentities)
      .set({ status: "active", updatedAt: now })
      .where(
        and(
          eq(schema.mailSenderIdentities.id, identityId),
          eq(schema.mailSenderIdentities.status, "suspended"),
        ),
      ),
    buildSenderIdentityAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.senderIdentityRestored,
      entityId: identityId,
      metadata: {
        senderIdentityId: identityId,
        previousStatus: "suspended",
        newStatus: "active",
        actorUserId: actor.userId,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Sender identity restore conflict");

  const updated = await findSenderIdentityById(db, identityId);
  if (!updated || updated.status !== "active") {
    throw MailServiceError.integrityConflict("Sender identity restore failed");
  }
  return toSafeSenderIdentityAdminView(updated);
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
