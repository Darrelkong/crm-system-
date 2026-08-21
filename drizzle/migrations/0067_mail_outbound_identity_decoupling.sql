-- Phase 2C.12C.3A-B.2 / 0067: Outbound identity decoupling (internal vs wire)
-- ADDITIVE ONLY. Depends on 0052–0066.
--
-- Purpose: decouple pre-send internal stable identity from canonical external wire
--   Message-ID without corrupting frozen outbound provenance.
--
-- Identity model (post-0067):
--   mail_outbound_rfc_identities.rfc_message_id
--     → INTERNAL client-stable message identity / send provenance (immutable pre-send).
--     NOT guaranteed to equal wire RFC Message-ID after Cloudflare Email Sending.
--   mail_transport_attempts.provider_message_id
--     → provider/delivery correlation only (unchanged).
--   mail_messages.internet_message_id (outbound)
--     → actual transmitted RFC Message-ID when known; NULL until proven.
--   mail_outbound_message_materializations.wire_internet_message_id
--     → durable materialization witness of wire identity when known; NULL otherwise.
--
-- Do NOT require:
--   internal rfc_message_id == mail_messages.internet_message_id
--   provider_message_id == wire_internet_message_id
--
-- Legacy rows: wire_internet_message_id copied as NULL — never from rfc_message_id.
-- Do NOT alter 0052–0066. Do NOT add provider_message_id to materializations.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- mail_messages — supporting parent key for always-on direction provenance
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_messages_id_direction
  ON mail_messages (id, direction);

-- ---------------------------------------------------------------------------
-- mail_outbound_message_materializations — rebuild with wire witness column
-- ---------------------------------------------------------------------------
CREATE TABLE mail_outbound_message_materializations_new (
  id TEXT PRIMARY KEY NOT NULL,
  send_operation_id TEXT NOT NULL,
  outbound_revision_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  hash_version INTEGER NOT NULL,
  accepted_transport_attempt_id TEXT NOT NULL,
  outbound_rfc_identity_id TEXT NOT NULL,
  rfc_message_id TEXT NOT NULL,
  wire_internet_message_id TEXT,
  mail_message_id TEXT NOT NULL,
  message_direction TEXT NOT NULL,
  materialized_at TEXT NOT NULL,
  FOREIGN KEY (send_operation_id) REFERENCES mail_send_operations (id),
  FOREIGN KEY (outbound_revision_id) REFERENCES mail_outbound_revisions (id),
  FOREIGN KEY (accepted_transport_attempt_id) REFERENCES mail_transport_attempts (id),
  FOREIGN KEY (outbound_rfc_identity_id) REFERENCES mail_outbound_rfc_identities (id),
  FOREIGN KEY (mail_message_id) REFERENCES mail_messages (id),
  FOREIGN KEY (
    send_operation_id,
    outbound_revision_id
  ) REFERENCES mail_send_operations (
    id,
    outbound_revision_id
  ),
  FOREIGN KEY (
    outbound_revision_id,
    content_hash,
    hash_version
  ) REFERENCES mail_outbound_revisions (
    id,
    content_hash,
    hash_version
  ),
  FOREIGN KEY (
    accepted_transport_attempt_id,
    send_operation_id
  ) REFERENCES mail_transport_attempts (
    id,
    send_operation_id
  ),
  FOREIGN KEY (
    outbound_rfc_identity_id,
    send_operation_id,
    rfc_message_id
  ) REFERENCES mail_outbound_rfc_identities (
    id,
    send_operation_id,
    rfc_message_id
  ),
  FOREIGN KEY (
    mail_message_id,
    message_direction
  ) REFERENCES mail_messages (
    id,
    direction
  ),
  FOREIGN KEY (
    mail_message_id,
    wire_internet_message_id,
    message_direction
  ) REFERENCES mail_messages (
    id,
    internet_message_id,
    direction
  ),
  CHECK (hash_version >= 1),
  CHECK (LENGTH(TRIM(content_hash)) > 0),
  CHECK (LENGTH(TRIM(rfc_message_id)) > 0),
  CHECK (
    wire_internet_message_id IS NULL
    OR LENGTH(TRIM(wire_internet_message_id)) > 0
  ),
  CHECK (message_direction = 'outbound')
);

INSERT INTO mail_outbound_message_materializations_new (
  id,
  send_operation_id,
  outbound_revision_id,
  content_hash,
  hash_version,
  accepted_transport_attempt_id,
  outbound_rfc_identity_id,
  rfc_message_id,
  wire_internet_message_id,
  mail_message_id,
  message_direction,
  materialized_at
)
SELECT
  id,
  send_operation_id,
  outbound_revision_id,
  content_hash,
  hash_version,
  accepted_transport_attempt_id,
  outbound_rfc_identity_id,
  rfc_message_id,
  NULL AS wire_internet_message_id,
  mail_message_id,
  message_direction,
  materialized_at
FROM mail_outbound_message_materializations;

DROP TABLE mail_outbound_message_materializations;

ALTER TABLE mail_outbound_message_materializations_new
  RENAME TO mail_outbound_message_materializations;

CREATE UNIQUE INDEX uq_mail_outbound_message_materializations_send_operation_id
  ON mail_outbound_message_materializations (send_operation_id);

CREATE UNIQUE INDEX uq_mail_outbound_message_materializations_mail_message_id
  ON mail_outbound_message_materializations (mail_message_id);

CREATE UNIQUE INDEX uq_mail_outbound_message_materializations_outbound_rfc_identity_id
  ON mail_outbound_message_materializations (outbound_rfc_identity_id);

CREATE INDEX idx_mail_outbound_message_materializations_outbound_revision_id
  ON mail_outbound_message_materializations (outbound_revision_id);

CREATE INDEX idx_mail_outbound_message_materializations_accepted_transport_attempt_id
  ON mail_outbound_message_materializations (accepted_transport_attempt_id);

PRAGMA foreign_keys = ON;
