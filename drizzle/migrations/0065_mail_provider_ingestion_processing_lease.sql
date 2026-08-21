-- Phase 2C.12A.1 / 0065: Durable provider ingestion processing lease
-- ADDITIVE ONLY. Depends on 0052–0064.
--
-- Purpose: durable processing claim / lease provenance on
--   mail_provider_ingestion_events so abandoned processing claims may be
--   safely recovered without racing an active worker.
--
-- V1 lease: 15 minutes (service layer — NOT stored as duration column).
--
-- Legacy rows with status = processing and both lease fields NULL are preserved
--   without fabricated timestamps. Post-0065 services MUST NOT create new
--   processing rows without a lease.
--
-- Do NOT alter 0052–0064. Do NOT add unrelated columns.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- mail_provider_ingestion_events — add processing lease columns + CHECK coupling
-- ---------------------------------------------------------------------------
CREATE TABLE mail_provider_ingestion_events_new (
  id TEXT PRIMARY KEY NOT NULL,
  event_kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  ingestion_dedupe_key TEXT NOT NULL,
  provider_event_id TEXT,
  provider_request_id TEXT,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  processing_version INTEGER NOT NULL DEFAULT 1,
  next_attempt_at TEXT,
  finalized_at TEXT,
  quarantine_reason TEXT,
  error_code TEXT,
  error_message TEXT,
  received_at TEXT NOT NULL,
  payload_storage_provider TEXT,
  payload_storage_key TEXT,
  payload_content_hash TEXT,
  payload_size_bytes INTEGER,
  processing_started_at TEXT,
  processing_lease_expires_at TEXT,
  CHECK (event_kind IN ('inbound_message', 'delivery_event')),
  CHECK (LENGTH(TRIM(provider)) > 0),
  CHECK (LENGTH(TRIM(ingestion_dedupe_key)) > 0),
  CHECK (status IN ('pending', 'processing', 'completed', 'quarantined')),
  CHECK (processing_version >= 1),
  CHECK (
    provider_event_id IS NULL
    OR LENGTH(TRIM(provider_event_id)) > 0
  ),
  CHECK (
    provider_request_id IS NULL
    OR LENGTH(TRIM(provider_request_id)) > 0
  ),
  CHECK (
    provider_message_id IS NULL
    OR LENGTH(TRIM(provider_message_id)) > 0
  ),
  CHECK (
    quarantine_reason IS NULL
    OR LENGTH(TRIM(quarantine_reason)) > 0
  ),
  CHECK (
    NOT (
      (processing_started_at IS NULL AND processing_lease_expires_at IS NOT NULL)
      OR (processing_started_at IS NOT NULL AND processing_lease_expires_at IS NULL)
    )
  ),
  CHECK (
    (status = 'pending'
      AND finalized_at IS NULL
      AND quarantine_reason IS NULL
      AND processing_started_at IS NULL
      AND processing_lease_expires_at IS NULL)
    OR
    (status = 'processing'
      AND finalized_at IS NULL
      AND quarantine_reason IS NULL
      AND next_attempt_at IS NULL
      AND (
        (processing_started_at IS NULL AND processing_lease_expires_at IS NULL)
        OR (
          processing_started_at IS NOT NULL
          AND processing_lease_expires_at IS NOT NULL
          AND processing_lease_expires_at > processing_started_at
        )
      ))
    OR
    (status = 'completed'
      AND finalized_at IS NOT NULL
      AND quarantine_reason IS NULL
      AND next_attempt_at IS NULL
      AND processing_started_at IS NULL
      AND processing_lease_expires_at IS NULL)
    OR
    (status = 'quarantined'
      AND finalized_at IS NOT NULL
      AND quarantine_reason IS NOT NULL
      AND next_attempt_at IS NULL
      AND processing_started_at IS NULL
      AND processing_lease_expires_at IS NULL)
  ),
  CHECK (
    (payload_storage_provider IS NULL
      AND payload_storage_key IS NULL
      AND payload_content_hash IS NULL
      AND payload_size_bytes IS NULL)
    OR
    (payload_storage_provider IS NOT NULL
      AND payload_storage_key IS NOT NULL
      AND payload_content_hash IS NOT NULL
      AND payload_size_bytes IS NOT NULL
      AND LENGTH(TRIM(payload_storage_provider)) > 0
      AND LENGTH(TRIM(payload_storage_key)) > 0
      AND length(payload_content_hash) = 64
      AND payload_content_hash = lower(payload_content_hash)
      AND payload_content_hash NOT GLOB '*[^0-9a-f]*'
      AND payload_size_bytes >= 0)
  )
);

INSERT INTO mail_provider_ingestion_events_new (
  id,
  event_kind,
  provider,
  ingestion_dedupe_key,
  provider_event_id,
  provider_request_id,
  provider_message_id,
  status,
  processing_version,
  next_attempt_at,
  finalized_at,
  quarantine_reason,
  error_code,
  error_message,
  received_at,
  payload_storage_provider,
  payload_storage_key,
  payload_content_hash,
  payload_size_bytes,
  processing_started_at,
  processing_lease_expires_at
)
SELECT
  id,
  event_kind,
  provider,
  ingestion_dedupe_key,
  provider_event_id,
  provider_request_id,
  provider_message_id,
  status,
  processing_version,
  next_attempt_at,
  finalized_at,
  quarantine_reason,
  error_code,
  error_message,
  received_at,
  payload_storage_provider,
  payload_storage_key,
  payload_content_hash,
  payload_size_bytes,
  NULL,
  NULL
FROM mail_provider_ingestion_events;

DROP TABLE mail_provider_ingestion_events;

ALTER TABLE mail_provider_ingestion_events_new
  RENAME TO mail_provider_ingestion_events;

CREATE UNIQUE INDEX uq_mail_provider_ingestion_events_ingestion_dedupe_key
  ON mail_provider_ingestion_events (ingestion_dedupe_key);

CREATE UNIQUE INDEX uq_mail_provider_ingestion_events_id_event_kind
  ON mail_provider_ingestion_events (id, event_kind);

CREATE UNIQUE INDEX uq_mail_provider_ingestion_events_id_ingestion_dedupe_key
  ON mail_provider_ingestion_events (id, ingestion_dedupe_key);

CREATE INDEX idx_mail_provider_ingestion_events_status_next_attempt
  ON mail_provider_ingestion_events (status, next_attempt_at);

CREATE INDEX idx_mail_provider_ingestion_events_event_kind_received_at
  ON mail_provider_ingestion_events (event_kind, received_at);

CREATE INDEX idx_mail_provider_ingestion_events_provider_event_id
  ON mail_provider_ingestion_events (provider_event_id);

CREATE INDEX idx_mail_provider_ingestion_events_provider_message_id
  ON mail_provider_ingestion_events (provider_message_id);

CREATE INDEX idx_mail_provider_ingestion_events_status_lease_expires
  ON mail_provider_ingestion_events (status, processing_lease_expires_at);

PRAGMA foreign_keys = ON;
