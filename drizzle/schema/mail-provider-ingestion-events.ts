import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const MAIL_PROVIDER_INGESTION_EVENT_KINDS = [
  "inbound_message",
  "delivery_event",
] as const;
export type MailProviderIngestionEventKind =
  (typeof MAIL_PROVIDER_INGESTION_EVENT_KINDS)[number];

export const MAIL_PROVIDER_INGESTION_STATUSES = [
  "pending",
  "processing",
  "completed",
  "quarantined",
] as const;
export type MailProviderIngestionStatus =
  (typeof MAIL_PROVIDER_INGESTION_STATUSES)[number];

/**
 * Generic provider-ingestion boundary — one row = one normalized provider semantic
 * event entering ECHFRONT BEFORE canonical mail_messages / mail_delivery_events.
 *
 * Provider ingestion is NOT canonical Mail state. Never let unresolved callbacks
 * guess mailbox/send/recipient/attempt provenance to enter canonical tables.
 *
 * completed status means ingestion processing completed — NOT Delivered.
 *
 * ingestion_dedupe_key: ECHFRONT semantic idempotency boundary (nonblank, UNIQUE).
 * UNIQUE conflict does NOT automatically mean harmless retry — service must verify
 * immutable semantics match; conflicting semantics → INTEGRITY conflict.
 *
 * For delivery_event: dedupe is per-recipient semantic outcome.
 * For inbound_message: dedupe distinguishes actual inbound envelope recipient.
 * Do NOT use random UUID as semantic dedupe key.
 *
 * Before inbound handler acknowledges acceptance, durable replay material
 * (ingestion event + private payload reference) must exist. Do NOT reuse
 * mail_stored_files for raw MIME ingestion payloads.
 *
 * Atomic completion (service layer — NOT trigger): canonical materialization +
 * status → completed must be atomic. completed without canonical effect forbidden.
 *
 * No CASCADE deletes. No raw webhook JSON/MIME/secrets in D1 columns.
 */
export const mailProviderIngestionEvents = sqliteTable(
  "mail_provider_ingestion_events",
  {
    id: text("id").primaryKey(),
    eventKind: text("event_kind", {
      enum: MAIL_PROVIDER_INGESTION_EVENT_KINDS,
    }).notNull(),
    provider: text("provider").notNull(),
    ingestionDedupeKey: text("ingestion_dedupe_key").notNull(),
    providerEventId: text("provider_event_id"),
    providerRequestId: text("provider_request_id"),
    providerMessageId: text("provider_message_id"),
    status: text("status", { enum: MAIL_PROVIDER_INGESTION_STATUSES })
      .notNull()
      .default("pending"),
    processingVersion: integer("processing_version").notNull().default(1),
    nextAttemptAt: text("next_attempt_at"),
    finalizedAt: text("finalized_at"),
    quarantineReason: text("quarantine_reason"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    receivedAt: text("received_at").notNull(),
    payloadStorageProvider: text("payload_storage_provider"),
    payloadStorageKey: text("payload_storage_key"),
    payloadContentHash: text("payload_content_hash"),
    payloadSizeBytes: integer("payload_size_bytes"),
    /** Set atomically on pending → processing claim (0065). NULL on non-processing. */
    processingStartedAt: text("processing_started_at"),
    /** Server-owned lease expiry; NULL unless status = processing with active lease. */
    processingLeaseExpiresAt: text("processing_lease_expires_at"),
  },
  (table) => [
    uniqueIndex("uq_mail_provider_ingestion_events_ingestion_dedupe_key").on(
      table.ingestionDedupeKey,
    ),
    uniqueIndex("uq_mail_provider_ingestion_events_id_event_kind").on(
      table.id,
      table.eventKind,
    ),
    uniqueIndex("uq_mail_provider_ingestion_events_id_ingestion_dedupe_key").on(
      table.id,
      table.ingestionDedupeKey,
    ),
    index("idx_mail_provider_ingestion_events_status_next_attempt").on(
      table.status,
      table.nextAttemptAt,
    ),
    index("idx_mail_provider_ingestion_events_event_kind_received_at").on(
      table.eventKind,
      table.receivedAt,
    ),
    index("idx_mail_provider_ingestion_events_provider_event_id").on(
      table.providerEventId,
    ),
    index("idx_mail_provider_ingestion_events_provider_message_id").on(
      table.providerMessageId,
    ),
    index("idx_mail_provider_ingestion_events_status_lease_expires").on(
      table.status,
      table.processingLeaseExpiresAt,
    ),
  ],
);

export type MailProviderIngestionEvent =
  typeof mailProviderIngestionEvents.$inferSelect;
export type NewMailProviderIngestionEvent =
  typeof mailProviderIngestionEvents.$inferInsert;
