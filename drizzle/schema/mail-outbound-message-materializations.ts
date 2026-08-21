import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  mailMessages,
  MAIL_MESSAGE_DIRECTIONS,
} from "./mail-messages";
import { mailOutboundRevisions } from "./mail-outbound-revisions";
import { mailOutboundRfcIdentities } from "./mail-outbound-rfc-identities";
import { mailSendOperations } from "./mail-send-operations";
import { mailTransportAttempts } from "./mail-transport-attempts";

/** Fixed outbound direction witness for materialization → mail_messages composite FK. */
export const MAIL_OUTBOUND_MATERIALIZATION_MESSAGE_DIRECTIONS = [
  "outbound",
] as const;
export type MailOutboundMaterializationMessageDirection =
  (typeof MAIL_OUTBOUND_MATERIALIZATION_MESSAGE_DIRECTIONS)[number];

/**
 * Outbound Sent message materialization — binds Send → accepted Attempt → mail_message.
 *
 * ONE row per logical Send Operation. ONE canonical mail_message per materialization.
 * Transport retries do NOT create additional materializations or mail_messages.
 * Delivery Events do NOT create mail_messages.
 *
 * Materialization timing (service layer — NOT trigger):
 *   Created ONLY after send_operation.status = accepted (provider accepted submission).
 *   Sent Message exists ≠ Delivered.
 *
 * Identity witnesses (0067):
 *   rfc_message_id — INTERNAL client-stable provenance from outbound_rfc_identities.
 *     NOT guaranteed to equal wire RFC Message-ID (Cloudflare controls wire identity).
 *   wire_internet_message_id — actual transmitted RFC Message-ID when known; NULL otherwise.
 *     When non-null, MUST equal mail_messages.internet_message_id (composite FK).
 *   message_direction — always outbound; always-on FK to mail_messages(id, direction).
 *
 * Provider transport identity remains on mail_transport_attempts.provider_message_id —
 *   NOT duplicated here. accepted_transport_attempt_id is the provider witness link.
 *
 * Copy content from exact immutable outbound Revision — NOT mutable Draft.
 * Complete recipient set equality (type, address, display name) is service invariant.
 *
 * Idempotent: materializeSentMessage(send_operation_id) retries resolve to same rows.
 *
 * RFC Identity may exist before acceptance; materialization only after Send accepted.
 *
 * No updated_at. No CASCADE. No delete API.
 */
export const mailOutboundMessageMaterializations = sqliteTable(
  "mail_outbound_message_materializations",
  {
    id: text("id").primaryKey(),
    sendOperationId: text("send_operation_id").notNull(),
    outboundRevisionId: text("outbound_revision_id").notNull(),
    contentHash: text("content_hash").notNull(),
    hashVersion: integer("hash_version").notNull(),
    acceptedTransportAttemptId: text("accepted_transport_attempt_id").notNull(),
    outboundRfcIdentityId: text("outbound_rfc_identity_id").notNull(),
    /** Internal client-stable provenance — NOT wire RFC Message-ID. */
    rfcMessageId: text("rfc_message_id").notNull(),
    /** Actual wire RFC Message-ID witness when known; NULL until proven. */
    wireInternetMessageId: text("wire_internet_message_id"),
    mailMessageId: text("mail_message_id").notNull(),
    messageDirection: text("message_direction", {
      enum: MAIL_OUTBOUND_MATERIALIZATION_MESSAGE_DIRECTIONS,
    }).notNull(),
    materializedAt: text("materialized_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_outbound_message_materializations_send_operation",
      columns: [table.sendOperationId],
      foreignColumns: [mailSendOperations.id],
    }),
    foreignKey({
      name: "fk_mail_outbound_message_materializations_outbound_revision",
      columns: [table.outboundRevisionId],
      foreignColumns: [mailOutboundRevisions.id],
    }),
    foreignKey({
      name: "fk_mail_outbound_message_materializations_transport_attempt",
      columns: [table.acceptedTransportAttemptId],
      foreignColumns: [mailTransportAttempts.id],
    }),
    foreignKey({
      name: "fk_mail_outbound_message_materializations_rfc_identity",
      columns: [table.outboundRfcIdentityId],
      foreignColumns: [mailOutboundRfcIdentities.id],
    }),
    foreignKey({
      name: "fk_mail_outbound_message_materializations_mail_message",
      columns: [table.mailMessageId],
      foreignColumns: [mailMessages.id],
    }),
    foreignKey({
      name: "fk_mail_outbound_message_materializations_send_revision_provenance",
      columns: [table.sendOperationId, table.outboundRevisionId],
      foreignColumns: [
        mailSendOperations.id,
        mailSendOperations.outboundRevisionId,
      ],
    }),
    foreignKey({
      name: "fk_mail_outbound_message_materializations_revision_hash_provenance",
      columns: [
        table.outboundRevisionId,
        table.contentHash,
        table.hashVersion,
      ],
      foreignColumns: [
        mailOutboundRevisions.id,
        mailOutboundRevisions.contentHash,
        mailOutboundRevisions.hashVersion,
      ],
    }),
    foreignKey({
      name: "fk_mail_outbound_message_materializations_attempt_send_provenance",
      columns: [table.acceptedTransportAttemptId, table.sendOperationId],
      foreignColumns: [
        mailTransportAttempts.id,
        mailTransportAttempts.sendOperationId,
      ],
    }),
    foreignKey({
      name: "fk_mail_outbound_message_materializations_rfc_identity_provenance",
      columns: [
        table.outboundRfcIdentityId,
        table.sendOperationId,
        table.rfcMessageId,
      ],
      foreignColumns: [
        mailOutboundRfcIdentities.id,
        mailOutboundRfcIdentities.sendOperationId,
        mailOutboundRfcIdentities.rfcMessageId,
      ],
    }),
    foreignKey({
      name: "fk_mail_outbound_message_materializations_mail_message_direction_provenance",
      columns: [table.mailMessageId, table.messageDirection],
      foreignColumns: [mailMessages.id, mailMessages.direction],
    }),
    foreignKey({
      name: "fk_mail_outbound_message_materializations_mail_message_wire_provenance",
      columns: [
        table.mailMessageId,
        table.wireInternetMessageId,
        table.messageDirection,
      ],
      foreignColumns: [
        mailMessages.id,
        mailMessages.internetMessageId,
        mailMessages.direction,
      ],
    }),
    uniqueIndex("uq_mail_outbound_message_materializations_send_operation_id").on(
      table.sendOperationId,
    ),
    uniqueIndex("uq_mail_outbound_message_materializations_mail_message_id").on(
      table.mailMessageId,
    ),
    uniqueIndex(
      "uq_mail_outbound_message_materializations_outbound_rfc_identity_id",
    ).on(table.outboundRfcIdentityId),
    index("idx_mail_outbound_message_materializations_outbound_revision_id").on(
      table.outboundRevisionId,
    ),
    index(
      "idx_mail_outbound_message_materializations_accepted_transport_attempt_id",
    ).on(table.acceptedTransportAttemptId),
  ],
);

export type MailOutboundMessageMaterialization =
  typeof mailOutboundMessageMaterializations.$inferSelect;
export type NewMailOutboundMessageMaterialization =
  typeof mailOutboundMessageMaterializations.$inferInsert;

// Re-export for parity checks — materialization direction must match mail_messages outbound.
export { MAIL_MESSAGE_DIRECTIONS };
