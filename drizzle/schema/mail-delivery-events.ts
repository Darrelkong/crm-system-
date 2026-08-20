import {
  foreignKey,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { mailOutboundRevisionRecipients } from "./mail-outbound-revision-recipients";
import { mailOutboundRevisions } from "./mail-outbound-revisions";
import { mailSendOperations } from "./mail-send-operations";
import { mailTransportAttempts } from "./mail-transport-attempts";

export const MAIL_DELIVERY_EVENT_TYPES = [
  "deferred",
  "delivered",
  "bounced",
] as const;
export type MailDeliveryEventType = (typeof MAIL_DELIVERY_EVENT_TYPES)[number];

/**
 * Immutable per-recipient delivery outcome evidence — append-only.
 *
 * Answers: "What delivery outcome did the provider report for THIS exact recipient
 * of THIS exact logical outbound send?"
 *
 * DELIVERY IS PER RECIPIENT. One Send Operation may produce different outcomes
 * per recipient (delivered / deferred / bounced). No global delivery status on Send.
 *
 * State owners: Approval (workflow), Send (logical execution), Transport (submission),
 * Delivery Event (recipient outcome after provider acceptance).
 * SEND accepted != delivered. TRANSPORT accepted != delivered.
 *
 * No updated_at. No mutable status. No current_status / is_delivered projection columns.
 * Provider retries for same semantic event → same event_dedupe_key (UNIQUE).
 *
 * transport_attempt_id REQUIRED (V1). Insert only after webhook correlated to accepted
 * Transport Attempt. Unmatched callbacks must NOT guess provenance — future quarantine domain.
 *
 * SECURITY/INTEGRITY (service layer): transport_attempt.state MUST be accepted before insert.
 * DB FK cannot prove accepted state statically — no triggers.
 *
 * event_dedupe_key: ECHFRONT idempotency boundary (nonblank, UNIQUE).
 * provider_event_id: optional diagnostic; NOT globally unique.
 *
 * provider_occurred_at nullable; received_at required. No occurred_at <= received_at CHECK.
 * Out-of-order/late/duplicate provider events recorded as immutable facts.
 *
 * Multiple deferred events per recipient allowed before delivered/bounced.
 * delivered/bounced terminality is projection semantics only — DB does not reject late events.
 *
 * Bcc recipients may be referenced internally; future read APIs must preserve Bcc privacy.
 *
 * provider_message_id stays on mail_transport_attempts — not duplicated here.
 *
 * No CASCADE deletes. Long-term audit history.
 */
export const mailDeliveryEvents = sqliteTable(
  "mail_delivery_events",
  {
    id: text("id").primaryKey(),
    sendOperationId: text("send_operation_id").notNull(),
    transportAttemptId: text("transport_attempt_id").notNull(),
    outboundRevisionId: text("outbound_revision_id").notNull(),
    outboundRevisionRecipientId: text(
      "outbound_revision_recipient_id",
    ).notNull(),
    eventType: text("event_type", { enum: MAIL_DELIVERY_EVENT_TYPES }).notNull(),
    eventDedupeKey: text("event_dedupe_key").notNull(),
    providerEventId: text("provider_event_id"),
    providerOccurredAt: text("provider_occurred_at"),
    receivedAt: text("received_at").notNull(),
    smtpStatusCode: text("smtp_status_code"),
    smtpEnhancedStatusCode: text("smtp_enhanced_status_code"),
    diagnosticMessage: text("diagnostic_message"),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_delivery_events_send_operation",
      columns: [table.sendOperationId],
      foreignColumns: [mailSendOperations.id],
    }),
    foreignKey({
      name: "fk_mail_delivery_events_transport_attempt",
      columns: [table.transportAttemptId],
      foreignColumns: [mailTransportAttempts.id],
    }),
    foreignKey({
      name: "fk_mail_delivery_events_outbound_revision",
      columns: [table.outboundRevisionId],
      foreignColumns: [mailOutboundRevisions.id],
    }),
    foreignKey({
      name: "fk_mail_delivery_events_revision_recipient",
      columns: [table.outboundRevisionRecipientId],
      foreignColumns: [mailOutboundRevisionRecipients.id],
    }),
    foreignKey({
      name: "fk_mail_delivery_events_send_revision_provenance",
      columns: [table.sendOperationId, table.outboundRevisionId],
      foreignColumns: [
        mailSendOperations.id,
        mailSendOperations.outboundRevisionId,
      ],
    }),
    foreignKey({
      name: "fk_mail_delivery_events_transport_send_provenance",
      columns: [table.transportAttemptId, table.sendOperationId],
      foreignColumns: [
        mailTransportAttempts.id,
        mailTransportAttempts.sendOperationId,
      ],
    }),
    foreignKey({
      name: "fk_mail_delivery_events_recipient_revision_provenance",
      columns: [table.outboundRevisionRecipientId, table.outboundRevisionId],
      foreignColumns: [
        mailOutboundRevisionRecipients.id,
        mailOutboundRevisionRecipients.revisionId,
      ],
    }),
    uniqueIndex("uq_mail_delivery_events_event_dedupe_key").on(
      table.eventDedupeKey,
    ),
    index("idx_mail_delivery_events_send_operation_received_at").on(
      table.sendOperationId,
      table.receivedAt,
    ),
    index("idx_mail_delivery_events_recipient_received_at").on(
      table.outboundRevisionRecipientId,
      table.receivedAt,
    ),
    index("idx_mail_delivery_events_transport_attempt_id").on(
      table.transportAttemptId,
    ),
    index("idx_mail_delivery_events_event_type_received_at").on(
      table.eventType,
      table.receivedAt,
    ),
    index("idx_mail_delivery_events_provider_event_id").on(
      table.providerEventId,
    ),
  ],
);

export type MailDeliveryEvent = typeof mailDeliveryEvents.$inferSelect;
export type NewMailDeliveryEvent = typeof mailDeliveryEvents.$inferInsert;
