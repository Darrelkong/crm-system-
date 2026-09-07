import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { assertMailDeliveryHealth } from "@/lib/permissions/mail";
import { runMailBatch } from "@/lib/mail/guarded-batch";

const ACTIVE_DELIVERY_TOKEN_STATES = ["armed", "confirmed"] as const;

export type LargeAttachmentOperationalSendView = {
  sendOperationId: string;
  outboundRevisionId: string;
  status: "dispatch_uncertain";
  authorizationMode: "admin_direct" | "staff_approved";
  subject: string;
  sender: {
    address: string;
    displayName: string | null;
  };
  mailbox: {
    id: string;
    address: string;
    displayName: string | null;
  };
  recipients: Array<{
    address: string;
    displayName: string | null;
    recipientType: string;
  }>;
  createdAt: string;
  completedAt: string | null;
  attempt: {
    id: string;
    attemptNumber: number;
    provider: string;
    providerRequestId: string | null;
    providerMessageId: string | null;
    startedAt: string;
    completedAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  } | null;
  largeAttachment: {
    involved: boolean;
    capabilityStates: Array<{
      deliveryTokenId: string;
      lifecycleId: string;
      state: "prepared" | "armed" | "confirmed" | "revoked" | "expired";
      expiresAt: string;
      providerMessageId: string | null;
    }>;
  };
};

async function loadSendContext(
  db: Database,
  sendOperationId: string,
): Promise<{
  send: typeof schema.mailSendOperations.$inferSelect;
  revision: typeof schema.mailOutboundRevisions.$inferSelect;
  mailbox: typeof schema.mailMailboxes.$inferSelect;
}> {
  const [row] = await db
    .select({
      send: schema.mailSendOperations,
      revision: schema.mailOutboundRevisions,
      mailbox: schema.mailMailboxes,
    })
    .from(schema.mailSendOperations)
    .innerJoin(
      schema.mailOutboundRevisions,
      eq(
        schema.mailSendOperations.outboundRevisionId,
        schema.mailOutboundRevisions.id,
      ),
    )
    .innerJoin(
      schema.mailMailboxes,
      eq(schema.mailOutboundRevisions.mailboxId, schema.mailMailboxes.id),
    )
    .where(eq(schema.mailSendOperations.id, sendOperationId))
    .limit(1);

  if (!row) {
    throw MailServiceError.notFound("Send operation not found");
  }
  return row;
}

async function loadUncertainSend(
  db: Database,
  sendOperationId: string,
): Promise<{
  send: typeof schema.mailSendOperations.$inferSelect;
  revision: typeof schema.mailOutboundRevisions.$inferSelect;
  mailbox: typeof schema.mailMailboxes.$inferSelect;
}> {
  const row = await loadSendContext(db, sendOperationId);
  if (row.send.status !== "dispatch_uncertain") {
    throw MailServiceError.conflict(
      "Operational detail is only available for uncertain sends",
    );
  }
  return row;
}

export async function getLargeAttachmentOperationalSendView(
  db: Database,
  actor: MailActorContext,
  sendOperationId: string,
): Promise<LargeAttachmentOperationalSendView> {
  assertMailDeliveryHealth(actor);
  const { send, revision, mailbox } = await loadUncertainSend(
    db,
    sendOperationId,
  );

  const [recipients, attachments, attempts, tokens] = await Promise.all([
    db
      .select()
      .from(schema.mailOutboundRevisionRecipients)
      .where(
        eq(schema.mailOutboundRevisionRecipients.revisionId, revision.id),
      )
      .orderBy(schema.mailOutboundRevisionRecipients.sortOrder),
    db
      .select({
        deliveryMode: schema.mailOutboundRevisionAttachments.deliveryMode,
      })
      .from(schema.mailOutboundRevisionAttachments)
      .where(
        eq(schema.mailOutboundRevisionAttachments.revisionId, revision.id),
      ),
    db
      .select()
      .from(schema.mailTransportAttempts)
      .where(eq(schema.mailTransportAttempts.sendOperationId, send.id))
      .orderBy(desc(schema.mailTransportAttempts.attemptNumber))
      .limit(1),
    db
      .select()
      .from(schema.mailLargeAttachmentDeliveryTokens)
      .where(
        eq(schema.mailLargeAttachmentDeliveryTokens.sendOperationId, send.id),
      )
      .orderBy(schema.mailLargeAttachmentDeliveryTokens.createdAt),
  ]);

  const attempt = attempts[0] ?? null;
  return {
    sendOperationId: send.id,
    outboundRevisionId: revision.id,
    status: "dispatch_uncertain",
    authorizationMode: send.authorizationMode,
    subject: revision.subject,
    sender: {
      address: revision.fromAddress,
      displayName: revision.fromDisplayName,
    },
    mailbox: {
      id: mailbox.id,
      address: mailbox.address,
      displayName: mailbox.displayName,
    },
    recipients: recipients.map((recipient) => ({
      address: recipient.address,
      displayName: recipient.displayName,
      recipientType: recipient.recipientType,
    })),
    createdAt: send.createdAt,
    completedAt: send.completedAt,
    attempt: attempt
      ? {
          id: attempt.id,
          attemptNumber: attempt.attemptNumber,
          provider: attempt.provider,
          providerRequestId: attempt.providerRequestId,
          providerMessageId: attempt.providerMessageId,
          startedAt: attempt.startedAt,
          completedAt: attempt.completedAt,
          errorCode: attempt.errorCode,
          errorMessage: attempt.errorMessage,
        }
      : null,
    largeAttachment: {
      involved: attachments.some(
        (attachment) => attachment.deliveryMode === "large_attachment",
      ),
      capabilityStates: tokens.map((token) => ({
        deliveryTokenId: token.id,
        lifecycleId: token.lifecycleId,
        state: token.state,
        expiresAt: token.expiresAt,
        providerMessageId: token.providerMessageId,
      })),
    },
  };
}

export async function acknowledgeUncertainSend(
  db: Database,
  actor: MailActorContext,
  sendOperationId: string,
): Promise<void> {
  assertMailDeliveryHealth(actor);
  const { send } = await loadUncertainSend(db, sendOperationId);
  const now = new Date().toISOString();
  await db.insert(schema.auditLogs).values({
    id: crypto.randomUUID(),
    userId: actor.userId,
    action: MAIL_AUDIT_ACTIONS.sendDispatchUncertainAcknowledged,
    entityType: "mail_send_operation",
    entityId: send.id,
    ipAddress: actor.audit.ipAddress ?? null,
    userAgent: actor.audit.userAgent ?? null,
    metadata: JSON.stringify({
      sendOperationId: send.id,
      action: "acknowledge_only",
      automaticResendAllowed: false,
    }),
    createdAt: now,
  });
}

export async function revokeLargeAttachmentCapabilities(
  db: Database,
  actor: MailActorContext,
  sendOperationId: string,
): Promise<{ revokedCount: number }> {
  assertMailDeliveryHealth(actor);
  const { send } = await loadSendContext(db, sendOperationId);
  const tokens = await db
    .select({
      id: schema.mailLargeAttachmentDeliveryTokens.id,
      state: schema.mailLargeAttachmentDeliveryTokens.state,
      providerMessageId: schema.mailLargeAttachmentDeliveryTokens.providerMessageId,
    })
    .from(schema.mailLargeAttachmentDeliveryTokens)
    .where(
      and(
        eq(schema.mailLargeAttachmentDeliveryTokens.sendOperationId, send.id),
        inArray(
          schema.mailLargeAttachmentDeliveryTokens.state,
          ACTIVE_DELIVERY_TOKEN_STATES,
        ),
      ),
    );

  if (tokens.length === 0) {
    return { revokedCount: 0 };
  }

  const now = new Date().toISOString();
  const statements = tokens.map((token) =>
    db
      .update(schema.mailLargeAttachmentDeliveryTokens)
      .set({
        state: "revoked",
        revokedAt: now,
        confirmedAt: null,
        providerMessageId: null,
        providerAcceptedAt: null,
      })
      .where(
        and(
          eq(schema.mailLargeAttachmentDeliveryTokens.id, token.id),
          inArray(schema.mailLargeAttachmentDeliveryTokens.state, [
            "armed",
            "confirmed",
          ]),
        ),
      ),
  );

  const results = await runMailBatch(db, statements);
  let revokedCount = 0;
  const revokedTokens: typeof tokens = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if ((results[index]?.meta?.changes ?? 0) === 1) {
      revokedCount += 1;
      revokedTokens.push(tokens[index]!);
    }
  }
  if (revokedTokens.length > 0) {
    await db.insert(schema.auditLogs).values(
      revokedTokens.map((token) => ({
        id: crypto.randomUUID(),
        userId: actor.userId,
        action: MAIL_AUDIT_ACTIONS.largeAttachmentCapabilityRevoked,
        entityType: "mail_send_operation",
        entityId: send.id,
        ipAddress: actor.audit.ipAddress ?? null,
        userAgent: actor.audit.userAgent ?? null,
        metadata: JSON.stringify({
          sendOperationId: send.id,
          deliveryTokenId: token.id,
          previousState: token.state,
          providerMessageId: token.providerMessageId,
          r2ObjectDeleted: false,
        }),
        createdAt: now,
      })),
    );
  }
  return { revokedCount };
}
