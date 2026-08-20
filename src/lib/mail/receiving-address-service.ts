import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { MailReceivingAddress } from "../../../drizzle/schema/mail-receiving-addresses";
import { buildInsertAuditLogSelectStatement } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import { assertValidEchfrontMailAddress } from "@/lib/mail/company-mail-address";
import {
  assertBatchUpdateChanged,
  buildPrimaryRotationPostStateAuditInsert,
  isMailPostStateGuardError,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import {
  findCurrentPrimaryReceivingAddress,
  findMailboxById,
  isUniqueConstraintError,
} from "@/lib/mail/mailbox-service";
import { assertMailAddressAssignment } from "@/lib/permissions/mail";

function buildReceivingAddressAuditInsert(
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
        ${"mail_receiving_address"} AS entity_type,
        ${input.entityId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
    `,
  );
}

async function getReceivingAddressById(
  db: Database,
  receivingAddressId: string,
): Promise<MailReceivingAddress | null> {
  const [row] = await db
    .select()
    .from(schema.mailReceivingAddresses)
    .where(eq(schema.mailReceivingAddresses.id, receivingAddressId))
    .limit(1);
  return row ?? null;
}

export async function addReceivingAlias(
  db: Database,
  actor: MailActorContext,
  input: { mailboxId: string; address: string },
): Promise<MailReceivingAddress> {
  assertMailAddressAssignment(actor);

  const normalizedAddress = assertValidEchfrontMailAddress(input.address);

  const mailbox = await findMailboxById(db, input.mailboxId);
  if (!mailbox) {
    throw MailServiceError.notFound("Mailbox not found");
  }

  const now = new Date().toISOString();
  const aliasId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  try {
    await runMailBatch(db, [
      db.insert(schema.mailReceivingAddresses).values({
        id: aliasId,
        mailboxId: input.mailboxId,
        address: normalizedAddress,
        addressType: "alias",
        status: "active",
        createdByUserId: actor.userId,
        createdAt: now,
        updatedAt: now,
      }),
      buildReceivingAddressAuditInsert(db, actor, {
        auditId,
        now,
        action: MAIL_AUDIT_ACTIONS.receivingAddressCreated,
        entityId: aliasId,
        metadata: {
          mailboxId: input.mailboxId,
          receivingAddressId: aliasId,
          address: normalizedAddress,
          addressType: "alias",
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

  const alias = await getReceivingAddressById(db, aliasId);
  if (!alias) {
    throw MailServiceError.integrityConflict("Alias creation failed");
  }
  return alias;
}

export async function suspendReceivingAddress(
  db: Database,
  actor: MailActorContext,
  receivingAddressId: string,
): Promise<MailReceivingAddress> {
  assertMailAddressAssignment(actor);

  const row = await getReceivingAddressById(db, receivingAddressId);
  if (!row) {
    throw MailServiceError.notFound("Receiving address not found");
  }
  if (row.status !== "active") {
    throw MailServiceError.conflict("Receiving address must be active to suspend", {
      currentStatus: row.status,
    });
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailReceivingAddresses)
      .set({ status: "suspended", updatedAt: now })
      .where(
        and(
          eq(schema.mailReceivingAddresses.id, receivingAddressId),
          eq(schema.mailReceivingAddresses.status, "active"),
        ),
      ),
    buildReceivingAddressAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.receivingAddressSuspended,
      entityId: receivingAddressId,
      metadata: {
        mailboxId: row.mailboxId,
        receivingAddressId,
        oldStatus: "active",
        newStatus: "suspended",
        address: row.address,
        actorUserId: actor.userId,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Receiving address suspend conflict");

  const updated = await getReceivingAddressById(db, receivingAddressId);
  if (!updated) {
    throw MailServiceError.notFound("Receiving address not found");
  }
  return updated;
}

export async function restoreReceivingAddress(
  db: Database,
  actor: MailActorContext,
  receivingAddressId: string,
): Promise<MailReceivingAddress> {
  assertMailAddressAssignment(actor);

  const row = await getReceivingAddressById(db, receivingAddressId);
  if (!row) {
    throw MailServiceError.notFound("Receiving address not found");
  }
  if (row.status === "retired") {
    throw MailServiceError.conflict(
      "Retired receiving addresses cannot be restored",
    );
  }
  if (row.status !== "suspended") {
    throw MailServiceError.conflict(
      "Receiving address must be suspended to restore",
      { currentStatus: row.status },
    );
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailReceivingAddresses)
      .set({ status: "active", updatedAt: now })
      .where(
        and(
          eq(schema.mailReceivingAddresses.id, receivingAddressId),
          eq(schema.mailReceivingAddresses.status, "suspended"),
        ),
      ),
    buildReceivingAddressAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.receivingAddressRestored,
      entityId: receivingAddressId,
      metadata: {
        mailboxId: row.mailboxId,
        receivingAddressId,
        oldStatus: "suspended",
        newStatus: "active",
        address: row.address,
        actorUserId: actor.userId,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Receiving address restore conflict");

  const updated = await getReceivingAddressById(db, receivingAddressId);
  if (!updated) {
    throw MailServiceError.notFound("Receiving address not found");
  }
  return updated;
}

export async function retireReceivingAddress(
  db: Database,
  actor: MailActorContext,
  receivingAddressId: string,
): Promise<MailReceivingAddress> {
  assertMailAddressAssignment(actor);

  const row = await getReceivingAddressById(db, receivingAddressId);
  if (!row) {
    throw MailServiceError.notFound("Receiving address not found");
  }
  if (row.addressType === "primary") {
    throw MailServiceError.conflict(
      "Current primary cannot be retired directly; use primary rotation",
    );
  }
  if (row.status === "retired") {
    throw MailServiceError.conflict("Receiving address is already retired");
  }
  if (row.status !== "active" && row.status !== "suspended") {
    throw MailServiceError.conflict("Receiving address cannot be retired", {
      currentStatus: row.status,
    });
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  const results = await runMailBatch(db, [
    db
      .update(schema.mailReceivingAddresses)
      .set({ status: "retired", retiredAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.mailReceivingAddresses.id, receivingAddressId),
          eq(schema.mailReceivingAddresses.addressType, "alias"),
          eq(schema.mailReceivingAddresses.status, row.status),
        ),
      ),
    buildReceivingAddressAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.receivingAddressRetired,
      entityId: receivingAddressId,
      metadata: {
        mailboxId: row.mailboxId,
        receivingAddressId,
        oldStatus: row.status,
        newStatus: "retired",
        address: row.address,
        actorUserId: actor.userId,
      },
    }),
  ]);

  assertBatchUpdateChanged(results, 0, "Receiving address retire conflict");

  const updated = await getReceivingAddressById(db, receivingAddressId);
  if (!updated) {
    throw MailServiceError.notFound("Receiving address not found");
  }
  return updated;
}

export async function rotatePrimaryReceivingAddress(
  db: Database,
  actor: MailActorContext,
  input: { mailboxId: string; newAddress: string },
): Promise<{
  mailboxAddress: string;
  oldPrimary: MailReceivingAddress;
  newPrimary: MailReceivingAddress;
}> {
  assertMailAddressAssignment(actor);

  const normalizedAddress = assertValidEchfrontMailAddress(input.newAddress);

  const mailbox = await findMailboxById(db, input.mailboxId);
  if (!mailbox) {
    throw MailServiceError.notFound("Mailbox not found");
  }

  const currentPrimary = await findCurrentPrimaryReceivingAddress(
    db,
    input.mailboxId,
  );
  if (!currentPrimary) {
    throw MailServiceError.integrityConflict(
      "Mailbox has no current primary receiving address",
    );
  }

  if (normalizedAddress === currentPrimary.address) {
    throw MailServiceError.validation(
      "New primary address must differ from current primary",
    );
  }

  const newPrimaryStatus = currentPrimary.status;
  const now = new Date().toISOString();
  const newPrimaryId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  try {
    await runMailBatch(db, [
      db
        .update(schema.mailReceivingAddresses)
        .set({ status: "retired", retiredAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.mailReceivingAddresses.id, currentPrimary.id),
            eq(schema.mailReceivingAddresses.mailboxId, input.mailboxId),
            eq(schema.mailReceivingAddresses.addressType, "primary"),
            eq(schema.mailReceivingAddresses.status, currentPrimary.status),
          ),
        ),
      db.insert(schema.mailReceivingAddresses).values({
        id: newPrimaryId,
        mailboxId: input.mailboxId,
        address: normalizedAddress,
        addressType: "primary",
        status: newPrimaryStatus,
        createdByUserId: actor.userId,
        createdAt: now,
        updatedAt: now,
      }),
      db
        .update(schema.mailMailboxes)
        .set({ address: normalizedAddress, updatedAt: now })
        .where(
          and(
            eq(schema.mailMailboxes.id, input.mailboxId),
            eq(schema.mailMailboxes.address, currentPrimary.address),
          ),
        ),
      buildPrimaryRotationPostStateAuditInsert(db, actor, {
        auditId,
        now,
        action: MAIL_AUDIT_ACTIONS.receivingAddressRotated,
        entityId: newPrimaryId,
        mailboxId: input.mailboxId,
        oldPrimaryId: currentPrimary.id,
        newPrimaryId,
        newAddress: normalizedAddress,
        newPrimaryStatus,
        metadata: {
          mailboxId: input.mailboxId,
          oldReceivingAddressId: currentPrimary.id,
          newReceivingAddressId: newPrimaryId,
          oldAddress: currentPrimary.address,
          newAddress: normalizedAddress,
          oldPrimaryStatus: currentPrimary.status,
          newPrimaryStatus,
          actorUserId: actor.userId,
        },
      }),
    ]);
  } catch (error) {
    if (isUniqueConstraintError(error) || isMailPostStateGuardError(error)) {
      throw MailServiceError.conflict(
        isUniqueConstraintError(error)
          ? "Address is already reserved"
          : "Primary rotation conflict",
      );
    }
    throw error;
  }

  const oldPrimary = await getReceivingAddressById(db, currentPrimary.id);
  const newPrimary = await getReceivingAddressById(db, newPrimaryId);
  const updatedMailbox = await findMailboxById(db, input.mailboxId);

  if (
    !oldPrimary ||
    oldPrimary.status !== "retired" ||
    !oldPrimary.retiredAt ||
    !newPrimary ||
    newPrimary.status !== newPrimaryStatus ||
    !updatedMailbox ||
    updatedMailbox.address !== normalizedAddress
  ) {
    throw MailServiceError.integrityConflict("Primary rotation incomplete");
  }

  return {
    mailboxAddress: updatedMailbox.address,
    oldPrimary,
    newPrimary,
  };
}

export { getReceivingAddressById };
