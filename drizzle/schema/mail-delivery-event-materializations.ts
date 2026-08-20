import { foreignKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { MAIL_DELIVERY_EVENT_TYPES, mailDeliveryEvents } from "./mail-delivery-events";
import { mailDeliveryIngestionEvents } from "./mail-delivery-ingestion-events";
import { mailProviderIngestionEvents } from "./mail-provider-ingestion-events";

/**
 * One normalized delivery ingestion event → at most one canonical mail_delivery_event.
 *
 * event_dedupe_key must match parent generic ingestion.ingestion_dedupe_key.
 * delivery_event_type must match staged delivery ingestion AND canonical event_type.
 *
 * Future service must verify resolved staged provenance exactly matches final
 * mail_delivery_events Send/Attempt/Revision/Recipient before materialization.
 *
 * No CASCADE deletes.
 */
export const mailDeliveryEventMaterializations = sqliteTable(
  "mail_delivery_event_materializations",
  {
    id: text("id").primaryKey(),
    ingestionEventId: text("ingestion_event_id").notNull(),
    deliveryEventId: text("delivery_event_id").notNull(),
    eventDedupeKey: text("event_dedupe_key").notNull(),
    deliveryEventType: text("delivery_event_type", {
      enum: MAIL_DELIVERY_EVENT_TYPES,
    }).notNull(),
    materializedAt: text("materialized_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_delivery_event_materializations_delivery_ingestion",
      columns: [table.ingestionEventId],
      foreignColumns: [mailDeliveryIngestionEvents.ingestionEventId],
    }),
    foreignKey({
      name: "fk_mail_delivery_event_materializations_delivery_event",
      columns: [table.deliveryEventId],
      foreignColumns: [mailDeliveryEvents.id],
    }),
    foreignKey({
      name: "fk_mail_delivery_event_materializations_dedupe_provenance",
      columns: [table.ingestionEventId, table.eventDedupeKey],
      foreignColumns: [
        mailProviderIngestionEvents.id,
        mailProviderIngestionEvents.ingestionDedupeKey,
      ],
    }),
    foreignKey({
      name: "fk_mail_delivery_event_materializations_staged_type_provenance",
      columns: [table.ingestionEventId, table.deliveryEventType],
      foreignColumns: [
        mailDeliveryIngestionEvents.ingestionEventId,
        mailDeliveryIngestionEvents.deliveryEventType,
      ],
    }),
    foreignKey({
      name: "fk_mail_delivery_event_materializations_canonical_type_provenance",
      columns: [table.deliveryEventId, table.deliveryEventType],
      foreignColumns: [mailDeliveryEvents.id, mailDeliveryEvents.eventType],
    }),
    uniqueIndex("uq_mail_delivery_event_materializations_ingestion_event_id").on(
      table.ingestionEventId,
    ),
    uniqueIndex("uq_mail_delivery_event_materializations_delivery_event_id").on(
      table.deliveryEventId,
    ),
  ],
);

export type MailDeliveryEventMaterialization =
  typeof mailDeliveryEventMaterializations.$inferSelect;
export type NewMailDeliveryEventMaterialization =
  typeof mailDeliveryEventMaterializations.$inferInsert;
