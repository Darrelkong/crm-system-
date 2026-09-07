import {
  foreignKey,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { mailLargeAttachmentLifecycle } from "./mail-large-attachment-lifecycle";
import { mailOutboundRevisions } from "./mail-outbound-revisions";
import { mailSendOperations } from "./mail-send-operations";
import { mailTransportAttempts } from "./mail-transport-attempts";

export const MAIL_LARGE_ATTACHMENT_DELIVERY_TOKEN_STATES = [
  "prepared",
  "armed",
  "confirmed",
  "revoked",
  "expired",
] as const;

export type MailLargeAttachmentDeliveryTokenState =
  (typeof MAIL_LARGE_ATTACHMENT_DELIVERY_TOKEN_STATES)[number];

/**
 * Durable recipient capability for a large attachment.
 *
 * The raw bearer token is intentionally absent. Only its SHA-256 hash is
 * persisted. An armed capability is usable by possession of the raw token,
 * while confirmed additionally records provider acceptance.
 */
export const mailLargeAttachmentDeliveryTokens = sqliteTable(
  "mail_large_attachment_delivery_tokens",
  {
    id: text("id").primaryKey(),
    lifecycleId: text("lifecycle_id")
      .notNull()
      .references(() => mailLargeAttachmentLifecycle.id),
    revisionId: text("revision_id")
      .notNull()
      .references(() => mailOutboundRevisions.id),
    sendOperationId: text("send_operation_id")
      .notNull()
      .references(() => mailSendOperations.id),
    transportAttemptId: text("transport_attempt_id")
      .notNull()
      .references(() => mailTransportAttempts.id),
    tokenHash: text("token_hash").notNull(),
    state: text("state", {
      enum: MAIL_LARGE_ATTACHMENT_DELIVERY_TOKEN_STATES,
    }).notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    armedAt: text("armed_at"),
    confirmedAt: text("confirmed_at"),
    revokedAt: text("revoked_at"),
    providerMessageId: text("provider_message_id"),
    providerAcceptedAt: text("provider_accepted_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_large_attachment_delivery_tokens_attempt_send",
      columns: [table.transportAttemptId, table.sendOperationId],
      foreignColumns: [
        mailTransportAttempts.id,
        mailTransportAttempts.sendOperationId,
      ],
    }),
    uniqueIndex(
      "uq_mail_large_attachment_delivery_tokens_active_lifecycle_revision_send",
    )
      .on(table.lifecycleId, table.revisionId, table.sendOperationId)
      .where(sql`${table.state} IN ('prepared', 'armed', 'confirmed')`),
    uniqueIndex("uq_mail_large_attachment_delivery_tokens_token_hash").on(
      table.tokenHash,
    ),
    index("idx_mail_large_attachment_delivery_tokens_state_expires").on(
      table.state,
      table.expiresAt,
    ),
    index("idx_mail_large_attachment_delivery_tokens_lifecycle").on(
      table.lifecycleId,
    ),
    index("idx_mail_large_attachment_delivery_tokens_send_operation").on(
      table.sendOperationId,
    ),
    index("idx_mail_large_attachment_delivery_tokens_transport_attempt").on(
      table.transportAttemptId,
    ),
    index("idx_mail_large_attachment_delivery_tokens_provider_message").on(
      table.providerMessageId,
    ),
  ],
);

export type MailLargeAttachmentDeliveryToken =
  typeof mailLargeAttachmentDeliveryTokens.$inferSelect;
export type NewMailLargeAttachmentDeliveryToken =
  typeof mailLargeAttachmentDeliveryTokens.$inferInsert;
