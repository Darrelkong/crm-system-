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
import { assertMailAccountManagement, assertMailAdminRead } from "@/lib/permissions/mail";
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

export async function createMailbox(
  db: Database,
  actor: MailActorContext,
  input: {
    address: string;
    displayName?: string | null;
    mailboxType: MailMailbox["mailboxType"];
  },
): Promise<MailboxWithCurrentPrimary> {
  assertMailAccountManagement(actor);

  const normalizedAddress = assertValidEchfrontMailAddress(input.address);

  const now = new Date().toISOString();
  const mailboxId = crypto.randomUUID();
  const primaryId = primaryReceivingAddressId(mailboxId);
  const auditId = crypto.randomUUID();

  try {
    await runMailBatch(db, [
      db.insert(schema.mailMailboxes).values({
        id: mailboxId,
        address: normalizedAddress,
        displayName: input.displayName?.trim() || null,
        mailboxType: input.mailboxType,
        status: "active",
        createdBy: actor.userId,
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
          actorUserId: actor.userId,
        },
      }),
    ]);
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
