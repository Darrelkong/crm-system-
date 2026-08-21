import type { MailNotificationType } from "../../../drizzle/schema/mail-notification-outbox";
import { schema, type Database } from "@/lib/db";
import type { ResolvedNotificationTarget } from "@/lib/mail/notification-source-recipient-resolution";

export type MailNotificationIntentInsertInput = {
  outboxId: string;
  notificationType: MailNotificationType;
  recipientUserId: string;
  notificationIdentityId: string;
  sourceEntityType: string;
  sourceEntityId: string;
  mailboxId?: string | null;
  now: string;
};

/**
 * Batch-safe notification intent INSERT with semantic idempotency.
 * ON CONFLICT DO NOTHING on the frozen semantic UNIQUE must not roll back
 * the surrounding business batch.
 */
export function buildMailNotificationIntentInsert(
  db: Database,
  input: MailNotificationIntentInsertInput,
) {
  return db
    .insert(schema.mailNotificationOutbox)
    .values({
      id: input.outboxId,
      notificationType: input.notificationType,
      recipientUserId: input.recipientUserId,
      notificationIdentityId: input.notificationIdentityId,
      sourceEntityType: input.sourceEntityType.trim(),
      sourceEntityId: input.sourceEntityId.trim(),
      mailboxId: input.mailboxId ?? null,
      status: "pending",
      processingVersion: 1,
      enqueuedAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({
      target: [
        schema.mailNotificationOutbox.notificationType,
        schema.mailNotificationOutbox.sourceEntityType,
        schema.mailNotificationOutbox.sourceEntityId,
        schema.mailNotificationOutbox.recipientUserId,
      ],
    });
}

export function buildResolvedNotificationIntentInsert(
  db: Database,
  input: {
    target: ResolvedNotificationTarget;
    notificationType: MailNotificationType;
    sourceEntityType: string;
    sourceEntityId: string;
    now: string;
    outboxId?: string;
  },
) {
  return buildMailNotificationIntentInsert(db, {
    outboxId: input.outboxId ?? crypto.randomUUID(),
    notificationType: input.notificationType,
    recipientUserId: input.target.recipientUserId,
    notificationIdentityId: input.target.notificationIdentityId,
    sourceEntityType: input.sourceEntityType,
    sourceEntityId: input.sourceEntityId,
    mailboxId: input.target.mailboxId,
    now: input.now,
  });
}
