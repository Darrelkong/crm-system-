import { and, eq, sql } from "drizzle-orm";
import type { MailNotificationOutboxStatus } from "../../../drizzle/schema/mail-notification-outbox";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import {
  buildNotificationOutboxAuditInsert,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import {
  assertVerificationResendCooldown,
  assertVerificationTokenIssueRateLimit,
  findAuthoritativePendingIdentityForUser,
  requireTargetUser,
} from "@/lib/mail/notification-identity-service";
import { enqueueMailNotificationIntent } from "@/lib/mail/notification-outbox-enqueue-service";
import { MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES } from "@/lib/mail/notification-source-entity-policy";
import { assertMailPermissionManagement } from "@/lib/permissions/mail";

/** Carrier notification_type — semantic identity is source_entity_type. */
export const VERIFICATION_OUTBOX_NOTIFICATION_TYPE = "new_incoming" as const;

export type VerificationDeliveryEnqueueResult = {
  outboxId: string;
  created: boolean;
  status: MailNotificationOutboxStatus;
  recipientUserId: string;
  notificationIdentityId: string;
  destinationEmail: string;
  enqueuedAt: string;
};

function buildVerificationSendSourceEntityId(): string {
  return crypto.randomUUID();
}

/**
 * Queue async verification challenge delivery — no token generation or transport.
 * Worker generates the raw challenge at dispatch time (MODEL B).
 */
export async function enqueueNotificationIdentityVerificationDelivery(
  db: Database,
  actor: MailActorContext,
  targetUserId: string,
  options?: { nowMs?: number },
): Promise<VerificationDeliveryEnqueueResult> {
  assertMailPermissionManagement(actor);
  await requireTargetUser(db, targetUserId);

  const pending = await findAuthoritativePendingIdentityForUser(
    db,
    targetUserId,
  );
  if (!pending) {
    throw MailServiceError.validation(
      "Active pending notification identity is required before verification challenge send",
    );
  }

  const nowMs = options?.nowMs ?? Date.now();
  await assertVerificationTokenIssueRateLimit(db, actor, nowMs);
  assertVerificationResendCooldown(pending, nowMs);

  const now = new Date(nowMs).toISOString();
  const sourceEntityId = buildVerificationSendSourceEntityId();

  const markRequested = await runMailBatch(db, [
    db
      .update(schema.mailNotificationIdentities)
      .set({
        verificationRequestedAt: now,
        verificationTokenHash: null,
        verificationExpiresAt: null,
        verificationAttemptCount: 0,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailNotificationIdentities.id, pending.id),
          eq(schema.mailNotificationIdentities.userId, pending.userId),
          eq(schema.mailNotificationIdentities.verificationStatus, "pending"),
          sql`${schema.mailNotificationIdentities.revokedAt} IS NULL`,
        ),
      ),
  ]);

  if ((markRequested[0]?.meta?.changes ?? 0) !== 1) {
    throw MailServiceError.conflict(
      "Pending notification identity changed before verification send queue",
    );
  }

  const { outbox, created } = await enqueueMailNotificationIntent(db, {
    notificationType: VERIFICATION_OUTBOX_NOTIFICATION_TYPE,
    recipientUserId: targetUserId,
    notificationIdentityId: pending.id,
    sourceEntityType:
      MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationIdentityVerification,
    sourceEntityId,
    mailboxId: null,
  });

  await runMailBatch(db, [
    buildNotificationOutboxAuditInsert(db, actor, {
      auditId: crypto.randomUUID(),
      now,
      action: MAIL_AUDIT_ACTIONS.notificationIdentityVerificationSendQueued,
      outboxId: outbox.id,
      metadata: {
        outboxId: outbox.id,
        targetUserId,
        notificationIdentityId: pending.id,
        destinationEmail: pending.email,
        sourceEntityId,
        created,
      },
    }),
  ]);

  return {
    outboxId: outbox.id,
    created,
    status: outbox.status,
    recipientUserId: targetUserId,
    notificationIdentityId: pending.id,
    destinationEmail: pending.email,
    enqueuedAt: outbox.enqueuedAt,
  };
}
