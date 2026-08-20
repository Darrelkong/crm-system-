import {
  foreignKey,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { MAIL_DELIVERY_EVENT_TYPES } from "./mail-delivery-events";
import { mailOutboundRevisionRecipients } from "./mail-outbound-revision-recipients";
import { mailOutboundRevisions } from "./mail-outbound-revisions";
import {
  MAIL_PROVIDER_INGESTION_EVENT_KINDS,
  mailProviderIngestionEvents,
} from "./mail-provider-ingestion-events";
import { mailSendOperations } from "./mail-send-operations";
import { mailTransportAttempts } from "./mail-transport-attempts";

/** Fixed delivery witness for child → parent event_kind provenance. */
export const MAIL_DELIVERY_INGESTION_EVENT_KINDS = ["delivery_event"] as const;
export type MailDeliveryIngestionEventKind =
  (typeof MAIL_DELIVERY_INGESTION_EVENT_KINDS)[number];

/**
 * Per-recipient delivery callback staging — one row = one normalized delivery outcome
 * waiting to be correlated/materialized into mail_delivery_events (0058).
 *
 * Correlation may be unresolved (all-or-none NULL) or resolved with 0058-style
 * composite FKs. Unmatched callbacks must NOT guess provenance.
 *
 * ingestion_dedupe_key on parent generic event is per-recipient semantic dedupe
 * identity copied to mail_delivery_events.event_dedupe_key on materialization.
 *
 * No opened/clicked. No CASCADE deletes.
 */
export const mailDeliveryIngestionEvents = sqliteTable(
  "mail_delivery_ingestion_events",
  {
    id: text("id").primaryKey(),
    ingestionEventId: text("ingestion_event_id").notNull(),
    eventKind: text("event_kind", {
      enum: MAIL_DELIVERY_INGESTION_EVENT_KINDS,
    }).notNull(),
    recipientAddress: text("recipient_address").notNull(),
    deliveryEventType: text("delivery_event_type", {
      enum: MAIL_DELIVERY_EVENT_TYPES,
    }).notNull(),
    providerOccurredAt: text("provider_occurred_at"),
    smtpStatusCode: text("smtp_status_code"),
    smtpEnhancedStatusCode: text("smtp_enhanced_status_code"),
    diagnosticMessage: text("diagnostic_message"),
    sendOperationId: text("send_operation_id"),
    transportAttemptId: text("transport_attempt_id"),
    outboundRevisionId: text("outbound_revision_id"),
    outboundRevisionRecipientId: text("outbound_revision_recipient_id"),
    correlatedAt: text("correlated_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_delivery_ingestion_events_ingestion_event",
      columns: [table.ingestionEventId],
      foreignColumns: [mailProviderIngestionEvents.id],
    }),
    foreignKey({
      name: "fk_mail_delivery_ingestion_events_send_operation",
      columns: [table.sendOperationId],
      foreignColumns: [mailSendOperations.id],
    }),
    foreignKey({
      name: "fk_mail_delivery_ingestion_events_transport_attempt",
      columns: [table.transportAttemptId],
      foreignColumns: [mailTransportAttempts.id],
    }),
    foreignKey({
      name: "fk_mail_delivery_ingestion_events_outbound_revision",
      columns: [table.outboundRevisionId],
      foreignColumns: [mailOutboundRevisions.id],
    }),
    foreignKey({
      name: "fk_mail_delivery_ingestion_events_revision_recipient",
      columns: [table.outboundRevisionRecipientId],
      foreignColumns: [mailOutboundRevisionRecipients.id],
    }),
    foreignKey({
      name: "fk_mail_delivery_ingestion_events_parent_kind",
      columns: [table.ingestionEventId, table.eventKind],
      foreignColumns: [
        mailProviderIngestionEvents.id,
        mailProviderIngestionEvents.eventKind,
      ],
    }),
    foreignKey({
      name: "fk_mail_delivery_ingestion_events_send_revision_provenance",
      columns: [table.sendOperationId, table.outboundRevisionId],
      foreignColumns: [
        mailSendOperations.id,
        mailSendOperations.outboundRevisionId,
      ],
    }),
    foreignKey({
      name: "fk_mail_delivery_ingestion_events_transport_send_provenance",
      columns: [table.transportAttemptId, table.sendOperationId],
      foreignColumns: [
        mailTransportAttempts.id,
        mailTransportAttempts.sendOperationId,
      ],
    }),
    foreignKey({
      name: "fk_mail_delivery_ingestion_events_recipient_revision_provenance",
      columns: [table.outboundRevisionRecipientId, table.outboundRevisionId],
      foreignColumns: [
        mailOutboundRevisionRecipients.id,
        mailOutboundRevisionRecipients.revisionId,
      ],
    }),
    uniqueIndex("uq_mail_delivery_ingestion_events_ingestion_event_id").on(
      table.ingestionEventId,
    ),
    uniqueIndex("uq_mail_delivery_ingestion_events_ingestion_delivery_type").on(
      table.ingestionEventId,
      table.deliveryEventType,
    ),
    index("idx_mail_delivery_ingestion_events_send_operation_id").on(
      table.sendOperationId,
    ),
    index("idx_mail_delivery_ingestion_events_transport_attempt_id").on(
      table.transportAttemptId,
    ),
    index("idx_mail_delivery_ingestion_events_recipient_address").on(
      table.recipientAddress,
    ),
  ],
);

export type MailDeliveryIngestionEvent =
  typeof mailDeliveryIngestionEvents.$inferSelect;
export type NewMailDeliveryIngestionEvent =
  typeof mailDeliveryIngestionEvents.$inferInsert;

export { MAIL_DELIVERY_EVENT_TYPES, MAIL_PROVIDER_INGESTION_EVENT_KINDS };
