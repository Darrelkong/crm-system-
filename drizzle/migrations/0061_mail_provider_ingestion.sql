-- Phase 2B.21 / 0061_mail_provider_ingestion.sql: Provider ingestion + quarantine boundary
-- ADDITIVE ONLY. No seed data. Depends on 0052–0060.
--
-- Purpose: durable provider-ingestion layer BEFORE canonical mail_messages and
--   mail_delivery_events. Supports inbound MIME staging, delivery callbacks,
--   dedupe, quarantine, replay workflow, and inbound envelope provenance.
--
-- Domain boundary (LOCKED):
--   Provider ingestion is NOT canonical Mail state.
--   Never let unresolved callbacks guess mailbox/send/recipient/attempt provenance
--   to enter canonical tables.
--
-- completed status means ingestion processing completed — NOT Delivered.
--
-- Dedupe collision contract (service layer):
--   UNIQUE conflict on ingestion_dedupe_key does NOT automatically mean harmless retry.
--   Service must verify immutable semantics match; conflicting semantics → INTEGRITY conflict.
--
-- Inbound durability (P0 service rule):
--   Before provider handler acknowledges inbound acceptance, durable replay material
--   (ingestion event + private payload reference) must exist. Do NOT reuse mail_stored_files
--   for raw MIME ingestion payloads.
--
-- Atomic completion boundary (service layer — NOT trigger):
--   Canonical materialization + generic ingestion status → completed must be atomic.
--   completed without canonical effect, or materialization without workflow transition, forbidden.
--
-- Original route owner (LOCKED):
--   route_owner_mailbox_id = Mailbox that owned the Receiving Address at routing resolution.
--   Preserved even when route_mode = fallback materializes into a different mailbox.
--
-- Inbound materialization cardinality (2B.21.1):
--   ONE ingestion_event_id → AT MOST ONE canonical mail_message (UNIQUE).
--   ONE canonical inbound mail_message → MAY HAVE MULTIPLE ingestion provenance links.
--   Same external RFC message may arrive via multiple envelope recipients to the same
--   Mailbox; 0053 (mailbox_id, internet_message_id) dedupe converges to one Message.
--   Each materialization row preserves its own envelope/receiving-address provenance.
--   Table acts as first-create provenance AND later envelope-delivery provenance link.
--   Fallback: multiple receiving aliases of an archived Mailbox may materialize into the
--   same authorized fallback Mailbox; if 0053 dedupe converges, multiple provenance links
--   may share mail_message_id while route_owner_mailbox_id remains distinct per row.
--
-- Existing message reuse (service layer — NOT trigger):
--   If 0053 inbound dedupe key already exists, DO NOT create duplicate mail_message.
--   After integrity verification, add another materialization row → SAME Message.
--   (mailbox_id, internet_message_id) conflict is NOT automatically harmless duplicate.
--   Conflicting semantic identity → QUARANTINE / INTEGRITY CONFLICT. Do NOT silently merge.
--   NULL internet_message_id: no 0053 dedupe guarantee; policy deferred to service.
--
-- No CASCADE deletes. No raw webhook JSON/MIME/secrets in D1 columns.
-- No customer association, Archive/Spam, shared workflow, auto-reply, or templates in 0061.

-- ---------------------------------------------------------------------------
-- Candidate keys on existing tables (0053/0058/0060 NOT edited — added here)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_mail_messages_id_mailbox_direction
  ON mail_messages (id, mailbox_id, direction);

CREATE UNIQUE INDEX uq_mail_receiving_addresses_id_mailbox_address
  ON mail_receiving_addresses (id, mailbox_id, address);

CREATE UNIQUE INDEX uq_mail_delivery_events_id_event_type
  ON mail_delivery_events (id, event_type);

-- ---------------------------------------------------------------------------
-- mail_provider_ingestion_events — one normalized provider semantic event
-- ---------------------------------------------------------------------------
CREATE TABLE mail_provider_ingestion_events (
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
  (status = 'pending'
    AND finalized_at IS NULL
    AND quarantine_reason IS NULL)
  OR
  (status = 'processing'
    AND finalized_at IS NULL
    AND quarantine_reason IS NULL
    AND next_attempt_at IS NULL)
  OR
  (status = 'completed'
    AND finalized_at IS NOT NULL
    AND quarantine_reason IS NULL
    AND next_attempt_at IS NULL)
  OR
  (status = 'quarantined'
    AND finalized_at IS NOT NULL
    AND quarantine_reason IS NOT NULL
    AND next_attempt_at IS NULL)
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

-- ---------------------------------------------------------------------------
-- mail_inbound_ingestion_events — inbound staging + envelope/routing provenance
-- ---------------------------------------------------------------------------
CREATE TABLE mail_inbound_ingestion_events (
  id TEXT PRIMARY KEY NOT NULL,
  ingestion_event_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  envelope_recipient_address TEXT NOT NULL,
  receiving_address_id TEXT,
  route_owner_mailbox_id TEXT,
  routed_address_snapshot TEXT,
  routed_at TEXT,
  FOREIGN KEY (ingestion_event_id) REFERENCES mail_provider_ingestion_events (id),
  FOREIGN KEY (route_owner_mailbox_id) REFERENCES mail_mailboxes (id),
  FOREIGN KEY (receiving_address_id) REFERENCES mail_receiving_addresses (id),
  FOREIGN KEY (
    ingestion_event_id,
    event_kind
  ) REFERENCES mail_provider_ingestion_events (
    id,
    event_kind
  ),
  FOREIGN KEY (
    receiving_address_id,
    route_owner_mailbox_id,
    routed_address_snapshot
  ) REFERENCES mail_receiving_addresses (
    id,
    mailbox_id,
    address
  ),
  CHECK (event_kind = 'inbound_message'),
  CHECK (LENGTH(TRIM(envelope_recipient_address)) > 0),
  CHECK (envelope_recipient_address = TRIM(envelope_recipient_address)),
  CHECK (
    (receiving_address_id IS NULL
      AND route_owner_mailbox_id IS NULL
      AND routed_address_snapshot IS NULL
      AND routed_at IS NULL)
    OR
    (receiving_address_id IS NOT NULL
      AND route_owner_mailbox_id IS NOT NULL
      AND routed_address_snapshot IS NOT NULL
      AND routed_at IS NOT NULL
      AND LENGTH(TRIM(routed_address_snapshot)) > 0
      AND routed_address_snapshot = TRIM(routed_address_snapshot))
  )
);

CREATE UNIQUE INDEX uq_mail_inbound_ingestion_events_ingestion_event_id
  ON mail_inbound_ingestion_events (ingestion_event_id);

CREATE INDEX idx_mail_inbound_ingestion_events_receiving_address_id
  ON mail_inbound_ingestion_events (receiving_address_id);

CREATE INDEX idx_mail_inbound_ingestion_events_route_owner_mailbox_id
  ON mail_inbound_ingestion_events (route_owner_mailbox_id);

CREATE UNIQUE INDEX uq_mail_inbound_ingestion_events_provenance
  ON mail_inbound_ingestion_events (
    ingestion_event_id,
    receiving_address_id,
    route_owner_mailbox_id,
    routed_address_snapshot,
    envelope_recipient_address
  );

-- ---------------------------------------------------------------------------
-- mail_inbound_message_materializations — ingestion provenance link(s) to canonical inbound message
-- One ingestion_event_id → at most one row. Multiple rows may share mail_message_id.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_inbound_message_materializations (
  id TEXT PRIMARY KEY NOT NULL,
  ingestion_event_id TEXT NOT NULL,
  receiving_address_id TEXT NOT NULL,
  route_owner_mailbox_id TEXT NOT NULL,
  routed_address_snapshot TEXT NOT NULL,
  envelope_recipient_address TEXT NOT NULL,
  mail_message_id TEXT NOT NULL,
  materialized_mailbox_id TEXT NOT NULL,
  route_mode TEXT NOT NULL,
  fallback_reason TEXT,
  message_direction TEXT NOT NULL,
  materialized_at TEXT NOT NULL,
  FOREIGN KEY (ingestion_event_id) REFERENCES mail_inbound_ingestion_events (ingestion_event_id),
  FOREIGN KEY (mail_message_id) REFERENCES mail_messages (id),
  FOREIGN KEY (materialized_mailbox_id) REFERENCES mail_mailboxes (id),
  FOREIGN KEY (route_owner_mailbox_id) REFERENCES mail_mailboxes (id),
  FOREIGN KEY (
    receiving_address_id,
    route_owner_mailbox_id,
    routed_address_snapshot
  ) REFERENCES mail_receiving_addresses (
    id,
    mailbox_id,
    address
  ),
  FOREIGN KEY (
    mail_message_id,
    materialized_mailbox_id,
    message_direction
  ) REFERENCES mail_messages (
    id,
    mailbox_id,
    direction
  ),
  FOREIGN KEY (
    ingestion_event_id,
    receiving_address_id,
    route_owner_mailbox_id,
    routed_address_snapshot,
    envelope_recipient_address
  ) REFERENCES mail_inbound_ingestion_events (
    ingestion_event_id,
    receiving_address_id,
    route_owner_mailbox_id,
    routed_address_snapshot,
    envelope_recipient_address
  ),
  CHECK (route_mode IN ('direct', 'fallback')),
  CHECK (message_direction = 'inbound'),
  CHECK (LENGTH(TRIM(envelope_recipient_address)) > 0),
  CHECK (envelope_recipient_address = TRIM(envelope_recipient_address)),
  CHECK (LENGTH(TRIM(routed_address_snapshot)) > 0),
  CHECK (routed_address_snapshot = TRIM(routed_address_snapshot)),
  CHECK (
    (route_mode = 'direct'
      AND materialized_mailbox_id = route_owner_mailbox_id
      AND fallback_reason IS NULL)
    OR
    (route_mode = 'fallback'
      AND materialized_mailbox_id != route_owner_mailbox_id
      AND fallback_reason IS NOT NULL
      AND LENGTH(TRIM(fallback_reason)) > 0)
  )
);

CREATE UNIQUE INDEX uq_mail_inbound_message_materializations_ingestion_event_id
  ON mail_inbound_message_materializations (ingestion_event_id);

CREATE INDEX idx_mail_inbound_message_materializations_mail_message_id
  ON mail_inbound_message_materializations (mail_message_id);

CREATE INDEX idx_mail_inbound_message_materializations_materialized_mailbox_id
  ON mail_inbound_message_materializations (materialized_mailbox_id);

-- ---------------------------------------------------------------------------
-- mail_delivery_ingestion_events — per-recipient delivery callback staging
-- ---------------------------------------------------------------------------
CREATE TABLE mail_delivery_ingestion_events (
  id TEXT PRIMARY KEY NOT NULL,
  ingestion_event_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  delivery_event_type TEXT NOT NULL,
  provider_occurred_at TEXT,
  smtp_status_code TEXT,
  smtp_enhanced_status_code TEXT,
  diagnostic_message TEXT,
  send_operation_id TEXT,
  transport_attempt_id TEXT,
  outbound_revision_id TEXT,
  outbound_revision_recipient_id TEXT,
  correlated_at TEXT,
  FOREIGN KEY (ingestion_event_id) REFERENCES mail_provider_ingestion_events (id),
  FOREIGN KEY (send_operation_id) REFERENCES mail_send_operations (id),
  FOREIGN KEY (transport_attempt_id) REFERENCES mail_transport_attempts (id),
  FOREIGN KEY (outbound_revision_id) REFERENCES mail_outbound_revisions (id),
  FOREIGN KEY (outbound_revision_recipient_id) REFERENCES mail_outbound_revision_recipients (id),
  FOREIGN KEY (
    ingestion_event_id,
    event_kind
  ) REFERENCES mail_provider_ingestion_events (
    id,
    event_kind
  ),
  FOREIGN KEY (
    send_operation_id,
    outbound_revision_id
  ) REFERENCES mail_send_operations (
    id,
    outbound_revision_id
  ),
  FOREIGN KEY (
    transport_attempt_id,
    send_operation_id
  ) REFERENCES mail_transport_attempts (
    id,
    send_operation_id
  ),
  FOREIGN KEY (
    outbound_revision_recipient_id,
    outbound_revision_id
  ) REFERENCES mail_outbound_revision_recipients (
    id,
    revision_id
  ),
  CHECK (event_kind = 'delivery_event'),
  CHECK (delivery_event_type IN ('deferred', 'delivered', 'bounced')),
  CHECK (LENGTH(TRIM(recipient_address)) > 0),
  CHECK (recipient_address = TRIM(recipient_address)),
  CHECK (
    smtp_status_code IS NULL
    OR LENGTH(TRIM(smtp_status_code)) > 0
  ),
  CHECK (
    smtp_enhanced_status_code IS NULL
    OR LENGTH(TRIM(smtp_enhanced_status_code)) > 0
  ),
  CHECK (
    diagnostic_message IS NULL
    OR LENGTH(TRIM(diagnostic_message)) > 0
  ),
  CHECK (
    (send_operation_id IS NULL
      AND transport_attempt_id IS NULL
      AND outbound_revision_id IS NULL
      AND outbound_revision_recipient_id IS NULL
      AND correlated_at IS NULL)
    OR
    (send_operation_id IS NOT NULL
      AND transport_attempt_id IS NOT NULL
      AND outbound_revision_id IS NOT NULL
      AND outbound_revision_recipient_id IS NOT NULL
      AND correlated_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_mail_delivery_ingestion_events_ingestion_event_id
  ON mail_delivery_ingestion_events (ingestion_event_id);

CREATE INDEX idx_mail_delivery_ingestion_events_send_operation_id
  ON mail_delivery_ingestion_events (send_operation_id);

CREATE INDEX idx_mail_delivery_ingestion_events_transport_attempt_id
  ON mail_delivery_ingestion_events (transport_attempt_id);

CREATE INDEX idx_mail_delivery_ingestion_events_recipient_address
  ON mail_delivery_ingestion_events (recipient_address);

CREATE UNIQUE INDEX uq_mail_delivery_ingestion_events_ingestion_delivery_type
  ON mail_delivery_ingestion_events (ingestion_event_id, delivery_event_type);

-- ---------------------------------------------------------------------------
-- mail_delivery_event_materializations — one ingestion → one canonical delivery event
-- ---------------------------------------------------------------------------
CREATE TABLE mail_delivery_event_materializations (
  id TEXT PRIMARY KEY NOT NULL,
  ingestion_event_id TEXT NOT NULL,
  delivery_event_id TEXT NOT NULL,
  event_dedupe_key TEXT NOT NULL,
  delivery_event_type TEXT NOT NULL,
  materialized_at TEXT NOT NULL,
  FOREIGN KEY (ingestion_event_id) REFERENCES mail_delivery_ingestion_events (ingestion_event_id),
  FOREIGN KEY (delivery_event_id) REFERENCES mail_delivery_events (id),
  FOREIGN KEY (
    ingestion_event_id,
    event_dedupe_key
  ) REFERENCES mail_provider_ingestion_events (
    id,
    ingestion_dedupe_key
  ),
  FOREIGN KEY (
    ingestion_event_id,
    delivery_event_type
  ) REFERENCES mail_delivery_ingestion_events (
    ingestion_event_id,
    delivery_event_type
  ),
  FOREIGN KEY (
    delivery_event_id,
    delivery_event_type
  ) REFERENCES mail_delivery_events (
    id,
    event_type
  ),
  CHECK (LENGTH(TRIM(event_dedupe_key)) > 0),
  CHECK (delivery_event_type IN ('deferred', 'delivered', 'bounced'))
);

CREATE UNIQUE INDEX uq_mail_delivery_event_materializations_ingestion_event_id
  ON mail_delivery_event_materializations (ingestion_event_id);

CREATE UNIQUE INDEX uq_mail_delivery_event_materializations_delivery_event_id
  ON mail_delivery_event_materializations (delivery_event_id);
