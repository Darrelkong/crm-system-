-- Phase 2C.9D: Freeze inbound route-resolution snapshot on staging child
-- ADDITIVE ONLY. Depends on 0052–0063.
--
-- Purpose: persist exact route-resolution decision at durable ingestion time,
--   especially resolved_fallback_mailbox_id, so future materialization (2C.10)
--   does NOT re-read live mail_company_config for already-staged events.
--
-- Existing rows: resolved_route_mode / resolved_fallback_mailbox_id left NULL
--   (legacy — no fabricated fallback history).
-- Service layer enforces snapshot on new staging after 0064.
--
-- Do NOT alter 0052–0063. Do NOT add unrelated columns.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- mail_inbound_ingestion_events — add frozen route-resolution snapshot
-- ---------------------------------------------------------------------------
CREATE TABLE mail_inbound_ingestion_events_new (
  id TEXT PRIMARY KEY NOT NULL,
  ingestion_event_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  envelope_recipient_address TEXT NOT NULL,
  receiving_address_id TEXT,
  route_owner_mailbox_id TEXT,
  routed_address_snapshot TEXT,
  routed_at TEXT,
  resolved_route_mode TEXT,
  resolved_fallback_mailbox_id TEXT,
  FOREIGN KEY (ingestion_event_id) REFERENCES mail_provider_ingestion_events (id),
  FOREIGN KEY (route_owner_mailbox_id) REFERENCES mail_mailboxes (id),
  FOREIGN KEY (receiving_address_id) REFERENCES mail_receiving_addresses (id),
  FOREIGN KEY (resolved_fallback_mailbox_id) REFERENCES mail_mailboxes (id),
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
  ),
  CHECK (
    resolved_route_mode IS NULL
    OR resolved_route_mode IN ('direct', 'fallback')
  ),
  CHECK (
    (resolved_route_mode IS NULL
      AND resolved_fallback_mailbox_id IS NULL)
    OR
    (resolved_route_mode = 'direct'
      AND route_owner_mailbox_id IS NOT NULL
      AND resolved_fallback_mailbox_id IS NULL)
    OR
    (resolved_route_mode = 'fallback'
      AND route_owner_mailbox_id IS NOT NULL
      AND resolved_fallback_mailbox_id IS NOT NULL
      AND resolved_fallback_mailbox_id <> route_owner_mailbox_id)
  )
);

INSERT INTO mail_inbound_ingestion_events_new (
  id,
  ingestion_event_id,
  event_kind,
  envelope_recipient_address,
  receiving_address_id,
  route_owner_mailbox_id,
  routed_address_snapshot,
  routed_at,
  resolved_route_mode,
  resolved_fallback_mailbox_id
)
SELECT
  id,
  ingestion_event_id,
  event_kind,
  envelope_recipient_address,
  receiving_address_id,
  route_owner_mailbox_id,
  routed_address_snapshot,
  routed_at,
  NULL,
  NULL
FROM mail_inbound_ingestion_events;

DROP TABLE mail_inbound_ingestion_events;

ALTER TABLE mail_inbound_ingestion_events_new RENAME TO mail_inbound_ingestion_events;

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

PRAGMA foreign_keys = ON;
