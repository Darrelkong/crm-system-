import { and, eq, inArray } from "drizzle-orm";
import type { MailMailbox } from "../../../drizzle/schema/mail-mailboxes";
import type { MailReceivingAddress } from "../../../drizzle/schema/mail-receiving-addresses";
import { buildInsertAuditLogSelectStatement } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { assertValidEchfrontMailAddress } from "@/lib/mail/company-mail-address";
import {
  buildCoordinatedMailboxPostStateAuditInsert,
  isMailPostStateGuardError,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import { MailServiceError } from "@/lib/mail/errors";
import {
  assertMailAccountManagement,
  assertMailAdminRead,
  isEligiblePersonalMailboxOwner,
} from "@/lib/permissions/mail";
import { sql } from "drizzle-orm";

export type MailboxWithCurrentPrimary = MailMailbox & {
  currentPrimary: MailReceivingAddress | null;
};

const CURRENT_PRIMARY_STATUSES = ["active", "suspended"] as const;

export async function findMailboxById(
  db: Database,
  mailboxId: string,
): Promise<MailMailbox | null> {
  const [row] = await db
    .select()
    .from(schema.mailMailboxes)
    .where(eq(schema.mailMailboxes.id, mailboxId))
    .limit(1);
  return row ?? null;
}

export async function findCurrentPrimaryReceivingAddress(
  db: Database,
  mailboxId: string,
): Promise<MailReceivingAddress | null> {
  const [row] = await db
    .select()
    .from(schema.mailReceivingAddresses)
    .where(
      and(
        eq(schema.mailReceivingAddresses.mailboxId, mailboxId),
        eq(schema.mailReceivingAddresses.addressType, "primary"),
        inArray(schema.mailReceivingAddresses.status, [
          ...CURRENT_PRIMARY_STATUSES,
        ]),
      ),
    )
    .limit(1);
  return row ?? null;
}

function primaryReceivingAddressId(mailboxId: string): string {
  return `mra_primary_${mailboxId}`;
}

function buildMailboxAuditInsert(
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
        ${"mail_mailbox"} AS entity_type,
        ${input.entityId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
    `,
  );
}

function buildMailboxMemberAuditInsert(
  db: Database,
  actor: MailActorContext,
  input: {
    auditId: string;
    now: string;
    memberId: string;
    mailboxId: string;
    userId: string;
  },
) {
  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        ${input.auditId} AS id,
        ${actor.userId} AS user_id,
        ${MAIL_AUDIT_ACTIONS.mailboxMemberGranted} AS action,
        ${"mail_mailbox_member"} AS entity_type,
        ${input.memberId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${JSON.stringify({
          mailboxId: input.mailboxId,
          targetUserId: input.userId,
          canRead: true,
          canReply: false,
          canSend: false,
          canAssign: false,
          canManageProcessing: false,
          canAddInternalNote: false,
          actorUserId: actor.userId,
        })} AS metadata,
        ${input.now} AS created_at
    `,
  );
}

async function resolvePersonalMailboxOwnerUserId(
  db: Database,
  ownerUserId: string,
): Promise<string> {
  const normalizedOwnerUserId = ownerUserId.trim();
  if (!normalizedOwnerUserId) {
    throw MailServiceError.validation("ownerUserId is required for personal mailboxes");
  }

  const [user] = await db
    .select({
      id: schema.users.id,
      isActive: schema.users.isActive,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, normalizedOwnerUserId))
    .limit(1);
  if (!user) {
    throw MailServiceError.notFound("Personal mailbox owner not found");
  }

  const userStatus =
    user.deletedAt != null
      ? "deleted"
      : user.isActive === 1
        ? "active"
        : "disabled";

  if (!isEligiblePersonalMailboxOwner({ userStatus })) {
    throw MailServiceError.validation(
      userStatus === "deleted"
        ? "Personal mailbox owner must not be deleted"
        : "Personal mailbox owner must be an active user",
    );
  }

  return normalizedOwnerUserId;
}

async function resolveMailboxOwnerUserId(
  db: Database,
  actor: MailActorContext,
  input: {
    mailboxType: MailMailbox["mailboxType"];
    ownerUserId?: string | null;
  },
): Promise<string> {
  if (input.mailboxType === "personal") {
    if (!input.ownerUserId?.trim()) {
      throw MailServiceError.validation(
        "ownerUserId is required for personal mailboxes",
      );
    }
    return resolvePersonalMailboxOwnerUserId(db, input.ownerUserId);
  }

  if (input.ownerUserId?.trim()) {
    throw MailServiceError.validation(
      "ownerUserId is only valid for personal mailboxes",
    );
  }

  return actor.userId;
}

export async function createMailbox(
  db: Database,
  actor: MailActorContext,
  input: {
    address: string;
    displayName?: string | null;
    mailboxType: MailMailbox["mailboxType"];
    ownerUserId?: string | null;
  },
): Promise<MailboxWithCurrentPrimary> {
  assertMailAccountManagement(actor);

  const normalizedAddress = assertValidEchfrontMailAddress(input.address);
  const mailboxOwnerUserId = await resolveMailboxOwnerUserId(db, actor, input);

  const now = new Date().toISOString();
  const mailboxId = crypto.randomUUID();
  const primaryId = primaryReceivingAddressId(mailboxId);
  const auditId = crypto.randomUUID();
  const ownerMembershipId =
    input.mailboxType === "personal" && mailboxOwnerUserId
      ? crypto.randomUUID()
      : null;
  const ownerMembershipAuditId = ownerMembershipId ? crypto.randomUUID() : null;

  try {
    const statements: Parameters<typeof runMailBatch>[1] = [
      db.insert(schema.mailMailboxes).values({
        id: mailboxId,
        address: normalizedAddress,
        displayName: input.displayName?.trim() || null,
        mailboxType: input.mailboxType,
        status: "active",
        createdBy: mailboxOwnerUserId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(schema.mailReceivingAddresses).values({
        id: primaryId,
        mailboxId,
        address: normalizedAddress,
        addressType: "primary",
        status: "active",
        createdByUserId: actor.userId,
        createdAt: now,
        updatedAt: now,
      }),
    ];

    if (ownerMembershipId) {
      statements.push(
        db.insert(schema.mailMailboxMembers).values({
          id: ownerMembershipId,
          mailboxId,
          userId: mailboxOwnerUserId,
          canRead: 1,
          canReply: 0,
          canSend: 0,
          canAssign: 0,
          canManageProcessing: 0,
          canAddInternalNote: 0,
          grantedBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        }),
      );
      statements.push(
        buildMailboxMemberAuditInsert(db, actor, {
          auditId: ownerMembershipAuditId!,
          now,
          memberId: ownerMembershipId,
          mailboxId,
          userId: mailboxOwnerUserId,
        }),
      );
    }

    statements.push(
      buildMailboxAuditInsert(db, actor, {
        auditId,
        now,
        action: MAIL_AUDIT_ACTIONS.mailboxCreated,
        entityId: mailboxId,
        metadata: {
          mailboxId,
          receivingAddressId: primaryId,
          address: normalizedAddress,
          mailboxType: input.mailboxType,
          ownerUserId:
            input.mailboxType === "personal" ? mailboxOwnerUserId : null,
          provisionedByUserId: actor.userId,
          actorUserId: actor.userId,
        },
      }),
    );
    await runMailBatch(db, statements);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw MailServiceError.conflict("Address is already reserved");
    }
    throw error;
  }

  const mailbox = await findMailboxById(db, mailboxId);
  const currentPrimary = await findCurrentPrimaryReceivingAddress(db, mailboxId);
  if (!mailbox || !currentPrimary) {
    throw MailServiceError.integrityConflict(
      "Mailbox created without primary route",
    );
  }
  return { ...mailbox, currentPrimary };
}

export async function getMailbox(
  db: Database,
  actor: MailActorContext,
  mailboxId: string,
): Promise<MailboxWithCurrentPrimary> {
  assertMailAdminRead(actor);
  const mailbox = await findMailboxById(db, mailboxId);
  if (!mailbox) {
    throw MailServiceError.notFound("Mailbox not found");
  }
  const currentPrimary = await findCurrentPrimaryReceivingAddress(
    db,
    mailboxId,
  );
  return { ...mailbox, currentPrimary };
}

export async function listMailboxesForAdmin(
  db: Database,
  actor: MailActorContext,
): Promise<MailboxWithCurrentPrimary[]> {
  assertMailAdminRead(actor);
  const mailboxes = await db.select().from(schema.mailMailboxes);
  const results: MailboxWithCurrentPrimary[] = [];
  for (const mailbox of mailboxes) {
    const currentPrimary = await findCurrentPrimaryReceivingAddress(
      db,
      mailbox.id,
    );
    results.push({ ...mailbox, currentPrimary });
  }
  return results;
}

export async function suspendMailbox(
  db: Database,
  actor: MailActorContext,
  mailboxId: string,
): Promise<MailboxWithCurrentPrimary> {
  assertMailAccountManagement(actor);

  const mailbox = await findMailboxById(db, mailboxId);
  if (!mailbox) {
    throw MailServiceError.notFound("Mailbox not found");
  }
  if (mailbox.status !== "active") {
    throw MailServiceError.conflict(
      "Mailbox must be active to suspend",
      { currentStatus: mailbox.status },
    );
  }

  const currentPrimary = await findCurrentPrimaryReceivingAddress(
    db,
    mailboxId,
  );
  if (!currentPrimary) {
    throw MailServiceError.integrityConflict(
      "Mailbox has no current primary receiving address",
    );
  }
  if (currentPrimary.status !== "active") {
    throw MailServiceError.conflict(
      "Current primary must be active to suspend mailbox",
      { primaryStatus: currentPrimary.status },
    );
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  try {
    await runMailBatch(db, [
      db
        .update(schema.mailMailboxes)
        .set({ status: "suspended", updatedAt: now })
        .where(
          and(
            eq(schema.mailMailboxes.id, mailboxId),
            eq(schema.mailMailboxes.status, "active"),
          ),
        ),
      db
        .update(schema.mailReceivingAddresses)
        .set({ status: "suspended", updatedAt: now })
        .where(
          and(
            eq(schema.mailReceivingAddresses.id, currentPrimary.id),
            eq(schema.mailReceivingAddresses.mailboxId, mailboxId),
            eq(schema.mailReceivingAddresses.status, "active"),
            eq(schema.mailReceivingAddresses.addressType, "primary"),
          ),
        ),
      buildCoordinatedMailboxPostStateAuditInsert(
        db,
        actor,
        {
          mailboxId,
          primaryId: currentPrimary.id,
          expectedMailboxStatus: "suspended",
          expectedPrimaryStatus: "suspended",
        },
        {
          auditId,
          now,
          action: MAIL_AUDIT_ACTIONS.mailboxSuspended,
          entityId: mailboxId,
          entityType: "mail_mailbox",
          metadata: {
            mailboxId,
            receivingAddressId: currentPrimary.id,
            oldMailboxStatus: "active",
            newMailboxStatus: "suspended",
            oldPrimaryStatus: "active",
            newPrimaryStatus: "suspended",
            actorUserId: actor.userId,
          },
        },
      ),
    ]);
  } catch (error) {
    if (isMailPostStateGuardError(error)) {
      throw MailServiceError.staleVersion("Mailbox suspend conflict");
    }
    throw error;
  }

  return getMailbox(db, actor, mailboxId);
}

export async function restoreMailbox(
  db: Database,
  actor: MailActorContext,
  mailboxId: string,
): Promise<MailboxWithCurrentPrimary> {
  assertMailAccountManagement(actor);

  const mailbox = await findMailboxById(db, mailboxId);
  if (!mailbox) {
    throw MailServiceError.notFound("Mailbox not found");
  }
  if (mailbox.status !== "suspended") {
    throw MailServiceError.conflict(
      "Mailbox must be suspended to restore",
      { currentStatus: mailbox.status },
    );
  }

  const currentPrimary = await findCurrentPrimaryReceivingAddress(
    db,
    mailboxId,
  );
  if (!currentPrimary) {
    throw MailServiceError.integrityConflict(
      "Mailbox has no current primary receiving address",
    );
  }
  if (currentPrimary.status !== "suspended") {
    throw MailServiceError.conflict(
      "Current primary must be suspended to restore mailbox",
      { primaryStatus: currentPrimary.status },
    );
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  try {
    await runMailBatch(db, [
      db
        .update(schema.mailMailboxes)
        .set({ status: "active", updatedAt: now })
        .where(
          and(
            eq(schema.mailMailboxes.id, mailboxId),
            eq(schema.mailMailboxes.status, "suspended"),
          ),
        ),
      db
        .update(schema.mailReceivingAddresses)
        .set({ status: "active", updatedAt: now })
        .where(
          and(
            eq(schema.mailReceivingAddresses.id, currentPrimary.id),
            eq(schema.mailReceivingAddresses.mailboxId, mailboxId),
            eq(schema.mailReceivingAddresses.status, "suspended"),
            eq(schema.mailReceivingAddresses.addressType, "primary"),
          ),
        ),
      buildCoordinatedMailboxPostStateAuditInsert(
        db,
        actor,
        {
          mailboxId,
          primaryId: currentPrimary.id,
          expectedMailboxStatus: "active",
          expectedPrimaryStatus: "active",
        },
        {
          auditId,
          now,
          action: MAIL_AUDIT_ACTIONS.mailboxRestored,
          entityId: mailboxId,
          entityType: "mail_mailbox",
          metadata: {
            mailboxId,
            receivingAddressId: currentPrimary.id,
            oldMailboxStatus: "suspended",
            newMailboxStatus: "active",
            oldPrimaryStatus: "suspended",
            newPrimaryStatus: "active",
            actorUserId: actor.userId,
          },
        },
      ),
    ]);
  } catch (error) {
    if (isMailPostStateGuardError(error)) {
      throw MailServiceError.staleVersion("Mailbox restore conflict");
    }
    throw error;
  }

  return getMailbox(db, actor, mailboxId);
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

export { isUniqueConstraintError };
