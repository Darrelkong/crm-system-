import {
  foreignKey,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { mailMailboxes } from "./mail-mailboxes";
import {
  MAIL_INBOUND_ROUTE_MODES,
  type MailInboundRouteMode,
} from "./mail-inbound-message-materializations";
import {
  MAIL_PROVIDER_INGESTION_EVENT_KINDS,
  mailProviderIngestionEvents,
} from "./mail-provider-ingestion-events";
import { mailReceivingAddresses } from "./mail-receiving-addresses";

/** Fixed inbound witness for child → parent event_kind provenance. */
export const MAIL_INBOUND_INGESTION_EVENT_KINDS = ["inbound_message"] as const;
export type MailInboundIngestionEventKind =
  (typeof MAIL_INBOUND_INGESTION_EVENT_KINDS)[number];

/**
 * Inbound-specific staging + envelope/routing provenance for one generic
 * inbound_message ingestion event.
 *
 * envelope_recipient_address: actual SMTP/envelope recipient — NOT visible To/Cc/Bcc.
 * Service normalization: trim, Unicode NFC, lowercase. No Gmail dot/plus transforms.
 *
 * Unresolved route: receiving_address_id, route_owner_mailbox_id,
 * routed_address_snapshot, routed_at all NULL.
 * Resolved route: all four NOT NULL + composite FK to mail_receiving_addresses.
 *
 * route_owner_mailbox_id = Mailbox that owned the Receiving Address at routing
 * resolution. Preserved even when fallback materializes into a different mailbox.
 *
 * resolved_route_mode / resolved_fallback_mailbox_id (0064):
 *   Frozen route-resolution snapshot at durable ingestion time.
 *   Future materialization (2C.10) MUST consume these — not live mail_company_config.
 *   NULL for quarantined/unresolved/legacy pre-0064 rows.
 */
export { MAIL_INBOUND_ROUTE_MODES, type MailInboundRouteMode };
export const mailInboundIngestionEvents = sqliteTable(
  "mail_inbound_ingestion_events",
  {
    id: text("id").primaryKey(),
    ingestionEventId: text("ingestion_event_id").notNull(),
    eventKind: text("event_kind", {
      enum: MAIL_INBOUND_INGESTION_EVENT_KINDS,
    }).notNull(),
    envelopeRecipientAddress: text("envelope_recipient_address").notNull(),
    receivingAddressId: text("receiving_address_id"),
    routeOwnerMailboxId: text("route_owner_mailbox_id"),
    routedAddressSnapshot: text("routed_address_snapshot"),
    routedAt: text("routed_at"),
    resolvedRouteMode: text("resolved_route_mode", {
      enum: MAIL_INBOUND_ROUTE_MODES,
    }),
    resolvedFallbackMailboxId: text("resolved_fallback_mailbox_id"),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_inbound_ingestion_events_ingestion_event",
      columns: [table.ingestionEventId],
      foreignColumns: [mailProviderIngestionEvents.id],
    }),
    foreignKey({
      name: "fk_mail_inbound_ingestion_events_route_owner_mailbox",
      columns: [table.routeOwnerMailboxId],
      foreignColumns: [mailMailboxes.id],
    }),
    foreignKey({
      name: "fk_mail_inbound_ingestion_events_receiving_address",
      columns: [table.receivingAddressId],
      foreignColumns: [mailReceivingAddresses.id],
    }),
    foreignKey({
      name: "fk_mail_inbound_ingestion_events_resolved_fallback_mailbox",
      columns: [table.resolvedFallbackMailboxId],
      foreignColumns: [mailMailboxes.id],
    }),
    foreignKey({
      name: "fk_mail_inbound_ingestion_events_parent_kind",
      columns: [table.ingestionEventId, table.eventKind],
      foreignColumns: [
        mailProviderIngestionEvents.id,
        mailProviderIngestionEvents.eventKind,
      ],
    }),
    foreignKey({
      name: "fk_mail_inbound_ingestion_events_receiving_address_provenance",
      columns: [
        table.receivingAddressId,
        table.routeOwnerMailboxId,
        table.routedAddressSnapshot,
      ],
      foreignColumns: [
        mailReceivingAddresses.id,
        mailReceivingAddresses.mailboxId,
        mailReceivingAddresses.address,
      ],
    }),
    uniqueIndex("uq_mail_inbound_ingestion_events_ingestion_event_id").on(
      table.ingestionEventId,
    ),
    uniqueIndex("uq_mail_inbound_ingestion_events_provenance").on(
      table.ingestionEventId,
      table.receivingAddressId,
      table.routeOwnerMailboxId,
      table.routedAddressSnapshot,
      table.envelopeRecipientAddress,
    ),
    index("idx_mail_inbound_ingestion_events_receiving_address_id").on(
      table.receivingAddressId,
    ),
    index("idx_mail_inbound_ingestion_events_route_owner_mailbox_id").on(
      table.routeOwnerMailboxId,
    ),
  ],
);

export type MailInboundIngestionEvent =
  typeof mailInboundIngestionEvents.$inferSelect;
export type NewMailInboundIngestionEvent =
  typeof mailInboundIngestionEvents.$inferInsert;

// Re-export parent kinds for parity checks.
export { MAIL_PROVIDER_INGESTION_EVENT_KINDS };
