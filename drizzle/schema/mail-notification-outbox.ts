import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { mailNotificationIdentities } from "./mail-notification-identities";
import { mailMailboxes } from "./mail-mailboxes";

export const MAIL_NOTIFICATION_TYPES = [
  "new_incoming",
  "approval_returned",
  "shared_assigned",
  "important_send_failure",
] as const;
export type MailNotificationType = (typeof MAIL_NOTIFICATION_TYPES)[number];

export const MAIL_NOTIFICATION_OUTBOX_STATUSES = [
  "pending",
  "processing",
  "sent",
  "failed_retryable",
  "failed_permanent",
] as const;
export type MailNotificationOutboxStatus =
  (typeof MAIL_NOTIFICATION_OUTBOX_STATUSES)[number];

/**
 * Durable external notification intent — NOT transport state.
 *
 * Stores notification_identity_id (not plaintext destination). Dispatch re-validates
 * identity + Mail access before any transport attempt.
 *
 * Semantic idempotency: UNIQUE(notification_type, source_entity_type,
 *   source_entity_id, recipient_user_id).
 *
 * processing_version: CAS for claim/finalize; binds attempt.processing_version.
 * V1 lease: 15 minutes (service layer).
 *
 * No CASCADE. No email body/subject snapshots.
 */
export const mailNotificationOutbox = sqliteTable(
  "mail_notification_outbox",
  {
    id: text("id").primaryKey(),
    notificationType: text("notification_type", {
      enum: MAIL_NOTIFICATION_TYPES,
    }).notNull(),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id),
    notificationIdentityId: text("notification_identity_id")
      .notNull()
      .references(() => mailNotificationIdentities.id),
    sourceEntityType: text("source_entity_type").notNull(),
    sourceEntityId: text("source_entity_id").notNull(),
    mailboxId: text("mailbox_id").references(() => mailMailboxes.id),
    status: text("status", { enum: MAIL_NOTIFICATION_OUTBOX_STATUSES }).notNull(),
    processingVersion: integer("processing_version").notNull().default(1),
    processingStartedAt: text("processing_started_at"),
    processingLeaseExpiresAt: text("processing_lease_expires_at"),
    nextAttemptAt: text("next_attempt_at"),
    failureCode: text("failure_code"),
    enqueuedAt: text("enqueued_at").notNull(),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_mail_notification_outbox_semantic_dedupe").on(
      table.notificationType,
      table.sourceEntityType,
      table.sourceEntityId,
      table.recipientUserId,
    ),
    index("idx_mail_notification_outbox_status_next_attempt").on(
      table.status,
      table.nextAttemptAt,
    ),
    index("idx_mail_notification_outbox_recipient_enqueued").on(
      table.recipientUserId,
      table.enqueuedAt,
    ),
    index("idx_mail_notification_outbox_notification_identity").on(
      table.notificationIdentityId,
    ),
    index("idx_mail_notification_outbox_status_lease_expires").on(
      table.status,
      table.processingLeaseExpiresAt,
    ),
  ],
);

export type MailNotificationOutbox = typeof mailNotificationOutbox.$inferSelect;
export type NewMailNotificationOutbox =
  typeof mailNotificationOutbox.$inferInsert;
