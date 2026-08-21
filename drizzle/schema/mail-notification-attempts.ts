import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { mailNotificationOutbox } from "./mail-notification-outbox";

export const MAIL_NOTIFICATION_ATTEMPT_STATES = [
  "started",
  "accepted",
  "temporary_failure",
  "permanent_failure",
  "outcome_unknown",
] as const;
export type MailNotificationAttemptState =
  (typeof MAIL_NOTIFICATION_ATTEMPT_STATES)[number];

/**
 * Append-only notification transport attempt provenance.
 *
 * attempt_number + processing_version are immutable after create.
 * At most one started attempt per outbox (partial UNIQUE).
 *
 * outcome_unknown: ambiguous network outcome — fail-closed V1, no auto-resend.
 *
 * No raw provider payloads. No updated_at.
 */
export const mailNotificationAttempts = sqliteTable(
  "mail_notification_attempts",
  {
    id: text("id").primaryKey(),
    notificationOutboxId: text("notification_outbox_id")
      .notNull()
      .references(() => mailNotificationOutbox.id),
    attemptNumber: integer("attempt_number").notNull(),
    processingVersion: integer("processing_version").notNull(),
    state: text("state", { enum: MAIL_NOTIFICATION_ATTEMPT_STATES }).notNull(),
    provider: text("provider").notNull(),
    providerRequestId: text("provider_request_id"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_notification_attempts_outbox",
      columns: [table.notificationOutboxId],
      foreignColumns: [mailNotificationOutbox.id],
    }),
    uniqueIndex("uq_mail_notification_attempts_outbox_attempt_number").on(
      table.notificationOutboxId,
      table.attemptNumber,
    ),
    uniqueIndex("uq_mail_notification_attempts_one_started_per_outbox")
      .on(table.notificationOutboxId)
      .where(sql`${table.state} = 'started'`),
    index("idx_mail_notification_attempts_outbox_started_at").on(
      table.notificationOutboxId,
      table.startedAt,
    ),
    index("idx_mail_notification_attempts_state").on(table.state),
  ],
);

export type MailNotificationAttempt =
  typeof mailNotificationAttempts.$inferSelect;
export type NewMailNotificationAttempt =
  typeof mailNotificationAttempts.$inferInsert;
