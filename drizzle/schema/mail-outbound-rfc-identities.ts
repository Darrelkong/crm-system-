import {
  foreignKey,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { mailOutboundRevisions } from "./mail-outbound-revisions";
import { mailSendOperations } from "./mail-send-operations";

/**
 * Stable RFC Message-ID identity — one immutable row per logical Send Operation.
 *
 * Created when Send becomes transport-ready (before/during dispatch).
 * Same rfc_message_id reused across every Transport retry — NOT per Attempt.
 *
 * At Sent materialization, rfc_message_id is copied to mail_messages.internet_message_id.
 *
 * RFC Message-ID ≠ provider_message_id (transport) ≠ provider_event_id (delivery).
 *
 * Message-ID generation (service layer — algorithm not implemented here):
 * deterministic/stable, valid RFC form, no sensitive data, collision-resistant.
 * RFC Message-ID is NOT part of Canonical Content Hash v1.
 *
 * No updated_at. No CASCADE.
 */
export const mailOutboundRfcIdentities = sqliteTable(
  "mail_outbound_rfc_identities",
  {
    id: text("id").primaryKey(),
    sendOperationId: text("send_operation_id").notNull(),
    outboundRevisionId: text("outbound_revision_id").notNull(),
    rfcMessageId: text("rfc_message_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_outbound_rfc_identities_send_operation",
      columns: [table.sendOperationId],
      foreignColumns: [mailSendOperations.id],
    }),
    foreignKey({
      name: "fk_mail_outbound_rfc_identities_outbound_revision",
      columns: [table.outboundRevisionId],
      foreignColumns: [mailOutboundRevisions.id],
    }),
    foreignKey({
      name: "fk_mail_outbound_rfc_identities_send_revision_provenance",
      columns: [table.sendOperationId, table.outboundRevisionId],
      foreignColumns: [
        mailSendOperations.id,
        mailSendOperations.outboundRevisionId,
      ],
    }),
    uniqueIndex("uq_mail_outbound_rfc_identities_send_operation_id").on(
      table.sendOperationId,
    ),
    uniqueIndex("uq_mail_outbound_rfc_identities_rfc_message_id").on(
      table.rfcMessageId,
    ),
    uniqueIndex("uq_mail_outbound_rfc_identities_id_send_operation_id").on(
      table.id,
      table.sendOperationId,
    ),
    uniqueIndex(
      "uq_mail_outbound_rfc_identities_id_send_operation_rfc_message_id",
    ).on(table.id, table.sendOperationId, table.rfcMessageId),
    index("idx_mail_outbound_rfc_identities_outbound_revision_id").on(
      table.outboundRevisionId,
    ),
  ],
);

export type MailOutboundRfcIdentity =
  typeof mailOutboundRfcIdentities.$inferSelect;
export type NewMailOutboundRfcIdentity =
  typeof mailOutboundRfcIdentities.$inferInsert;
