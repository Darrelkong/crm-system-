import {
  foreignKey,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { mailInboundIngestionEvents } from "./mail-inbound-ingestion-events";
import { mailMailboxes } from "./mail-mailboxes";
import { mailMessages } from "./mail-messages";
import { mailReceivingAddresses } from "./mail-receiving-addresses";

export const MAIL_INBOUND_ROUTE_MODES = ["direct", "fallback"] as const;
export type MailInboundRouteMode = (typeof MAIL_INBOUND_ROUTE_MODES)[number];

/** Fixed inbound direction witness for materialization → mail_messages composite FK. */
export const MAIL_INBOUND_MATERIALIZATION_MESSAGE_DIRECTIONS = [
  "inbound",
] as const;
export type MailInboundMaterializationMessageDirection =
  (typeof MAIL_INBOUND_MATERIALIZATION_MESSAGE_DIRECTIONS)[number];

/**
 * Inbound ingestion provenance link to canonical mail_message.
 *
 * Cardinality (2B.21.1):
 *   ONE ingestion_event_id → AT MOST ONE row (UNIQUE).
 *   ONE canonical inbound mail_message → MAY HAVE MULTIPLE provenance links.
 *
 * Acts as both:
 *   (A) materialization provenance for the ingestion that first creates the Message, and
 *   (B) ingestion-provenance link for later envelope deliveries converging on an existing Message.
 *
 * Same external RFC message may arrive via multiple envelope recipients (e.g. daniel@ and
 * daniel.alias@) to the same Mailbox. 0053 (mailbox_id, internet_message_id) dedupe converges
 * to one Message; each row retains distinct receiving_address_id / envelope_recipient_address.
 *
 * Existing message reuse (service layer):
 *   If 0053 inbound dedupe key exists, add another row → SAME mail_message_id after verification.
 *   Dedupe conflict is NOT automatically harmless — conflicting semantics → QUARANTINE.
 *   NULL internet_message_id: no 0053 dedupe guarantee; policy deferred.
 *
 * Copies/freezes exact inbound-routing provenance from resolved inbound ingestion row.
 * route_owner_mailbox_id preserved even on fallback — original route owner NOT reassigned.
 *
 * Idempotent: materializeInboundMessage(ingestion_event_id) retries resolve to same row.
 *
 * Future service must atomically coordinate canonical materialization +
 * generic ingestion status → completed (NOT trigger-enforced).
 *
 * No CASCADE deletes.
 */
export const mailInboundMessageMaterializations = sqliteTable(
  "mail_inbound_message_materializations",
  {
    id: text("id").primaryKey(),
    ingestionEventId: text("ingestion_event_id").notNull(),
    receivingAddressId: text("receiving_address_id").notNull(),
    routeOwnerMailboxId: text("route_owner_mailbox_id").notNull(),
    routedAddressSnapshot: text("routed_address_snapshot").notNull(),
    envelopeRecipientAddress: text("envelope_recipient_address").notNull(),
    mailMessageId: text("mail_message_id").notNull(),
    materializedMailboxId: text("materialized_mailbox_id").notNull(),
    routeMode: text("route_mode", { enum: MAIL_INBOUND_ROUTE_MODES }).notNull(),
    fallbackReason: text("fallback_reason"),
    messageDirection: text("message_direction", {
      enum: MAIL_INBOUND_MATERIALIZATION_MESSAGE_DIRECTIONS,
    }).notNull(),
    materializedAt: text("materialized_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_inbound_message_materializations_inbound_ingestion",
      columns: [table.ingestionEventId],
      foreignColumns: [mailInboundIngestionEvents.ingestionEventId],
    }),
    foreignKey({
      name: "fk_mail_inbound_message_materializations_mail_message",
      columns: [table.mailMessageId],
      foreignColumns: [mailMessages.id],
    }),
    foreignKey({
      name: "fk_mail_inbound_message_materializations_materialized_mailbox",
      columns: [table.materializedMailboxId],
      foreignColumns: [mailMailboxes.id],
    }),
    foreignKey({
      name: "fk_mail_inbound_message_materializations_route_owner_mailbox",
      columns: [table.routeOwnerMailboxId],
      foreignColumns: [mailMailboxes.id],
    }),
    foreignKey({
      name: "fk_mail_inbound_message_materializations_receiving_address_provenance",
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
    foreignKey({
      name: "fk_mail_inbound_message_materializations_mail_message_provenance",
      columns: [
        table.mailMessageId,
        table.materializedMailboxId,
        table.messageDirection,
      ],
      foreignColumns: [
        mailMessages.id,
        mailMessages.mailboxId,
        mailMessages.direction,
      ],
    }),
    foreignKey({
      name: "fk_mail_inbound_message_materializations_inbound_provenance",
      columns: [
        table.ingestionEventId,
        table.receivingAddressId,
        table.routeOwnerMailboxId,
        table.routedAddressSnapshot,
        table.envelopeRecipientAddress,
      ],
      foreignColumns: [
        mailInboundIngestionEvents.ingestionEventId,
        mailInboundIngestionEvents.receivingAddressId,
        mailInboundIngestionEvents.routeOwnerMailboxId,
        mailInboundIngestionEvents.routedAddressSnapshot,
        mailInboundIngestionEvents.envelopeRecipientAddress,
      ],
    }),
    uniqueIndex("uq_mail_inbound_message_materializations_ingestion_event_id").on(
      table.ingestionEventId,
    ),
    index("idx_mail_inbound_message_materializations_mail_message_id").on(
      table.mailMessageId,
    ),
    index("idx_mail_inbound_message_materializations_materialized_mailbox_id").on(
      table.materializedMailboxId,
    ),
  ],
);

export type MailInboundMessageMaterialization =
  typeof mailInboundMessageMaterializations.$inferSelect;
export type NewMailInboundMessageMaterialization =
  typeof mailInboundMessageMaterializations.$inferInsert;
