import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { mailSendOperations } from "./mail-send-operations";

export const MAIL_TRANSPORT_ATTEMPT_STATES = [
  "started",
  "accepted",
  "temporary_failure",
  "permanent_failure",
] as const;
export type MailTransportAttemptState =
  (typeof MAIL_TRANSPORT_ATTEMPT_STATES)[number];

/**
 * One provider submission attempt for one logical Send Operation.
 *
 * state=accepted means this attempt received provider acceptance — NOT delivery.
 * temporary_failure may retry (retry_after_at optional); permanent_failure is terminal for attempt.
 *
 * At most one started Attempt per Send Operation (partial UNIQUE WHERE state = 'started').
 * UNIQUE(send_operation_id, attempt_number) is an independent additional guard.
 *
 * No orchestration_version — that belongs only to mail_send_operations.
 * attempt_number is immutable per row; state lifecycle: started → accepted/temporary/permanent.
 *
 * provider: nonblank adapter identifier — NOT hardcoded to Cloudflare.
 * No credentials, secrets, or raw provider response blobs.
 *
 * No updated_at. No CASCADE. No delivery/bounce state.
 */
export const mailTransportAttempts = sqliteTable(
  "mail_transport_attempts",
  {
    id: text("id").primaryKey(),
    sendOperationId: text("send_operation_id")
      .notNull()
      .references(() => mailSendOperations.id),
    attemptNumber: integer("attempt_number").notNull(),
    state: text("state", { enum: MAIL_TRANSPORT_ATTEMPT_STATES }).notNull(),
    provider: text("provider").notNull(),
    providerRequestId: text("provider_request_id"),
    providerMessageId: text("provider_message_id"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    retryAfterAt: text("retry_after_at"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_transport_attempts_send_operation",
      columns: [table.sendOperationId],
      foreignColumns: [mailSendOperations.id],
    }),
    uniqueIndex("uq_mail_transport_attempts_send_operation_attempt_number").on(
      table.sendOperationId,
      table.attemptNumber,
    ),
    uniqueIndex("uq_mail_transport_attempts_one_started_per_send_operation")
      .on(table.sendOperationId)
      .where(sql`${table.state} = 'started'`),
    index("idx_mail_transport_attempts_send_operation_started_at").on(
      table.sendOperationId,
      table.startedAt,
    ),
    index("idx_mail_transport_attempts_state").on(table.state),
    index("idx_mail_transport_attempts_provider_message_id").on(
      table.providerMessageId,
    ),
    uniqueIndex("uq_mail_transport_attempts_id_send_operation_id").on(
      table.id,
      table.sendOperationId,
    ),
  ],
);

export type MailTransportAttempt = typeof mailTransportAttempts.$inferSelect;
export type NewMailTransportAttempt = typeof mailTransportAttempts.$inferInsert;
