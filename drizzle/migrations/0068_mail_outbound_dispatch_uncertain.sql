-- Phase 2H-6N.1C: Outbound ambiguous provider dispatch state foundation
-- Phase 2H-6N.1C-R: D1-compatible FK semantics (defer_foreign_keys only)
-- ADDITIVE SEMANTIC EXTENSION. Depends on 0057–0067.
--
-- Rebuild graph (derived from FK audit):
--   mail_send_operations
--   mail_transport_attempts
--   mail_outbound_rfc_identities
--   mail_delivery_events
--   mail_outbound_message_materializations
--   mail_delivery_ingestion_events
--   mail_delivery_event_materializations
--
-- DROP order (deepest children first): delivery_event_materializations →
--   delivery_ingestion_events → outbound_message_materializations →
--   delivery_events → rfc_identities → transport_attempts → send_operations

PRAGMA defer_foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- mail_send_operations — extend status CHECK with dispatch_uncertain
-- ---------------------------------------------------------------------------
CREATE TABLE mail_send_operations_new (
  id TEXT PRIMARY KEY NOT NULL,
  outbound_revision_id TEXT NOT NULL,
  revision_chain_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  hash_version INTEGER NOT NULL,
  revision_kind TEXT NOT NULL,
  authorization_mode TEXT NOT NULL,
  approval_id TEXT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  orchestration_version INTEGER NOT NULL DEFAULT 1,
  initiated_by_user_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  next_attempt_at TEXT,
  FOREIGN KEY (approval_id) REFERENCES mail_outbound_approvals (id),
  FOREIGN KEY (
    outbound_revision_id,
    revision_chain_id,
    content_hash,
    hash_version,
    revision_kind
  ) REFERENCES mail_outbound_revisions (
    id,
    revision_chain_id,
    content_hash,
    hash_version,
    revision_kind
  ),
  FOREIGN KEY (
    approval_id,
    outbound_revision_id,
    content_hash,
    hash_version
  ) REFERENCES mail_outbound_approvals (
    id,
    approved_revision_id,
    approved_content_hash,
    approved_hash_version
  ),
  FOREIGN KEY (initiated_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (authorization_mode IN ('staff_approved', 'admin_direct')),
  CHECK (revision_kind IN ('staff_submit', 'staff_resubmit', 'admin_edit', 'admin_direct')),
  CHECK (
    status IN (
      'pending',
      'processing',
      'accepted',
      'failed',
      'dispatch_uncertain'
    )
  ),
  CHECK (hash_version >= 1),
  CHECK (orchestration_version >= 1),
  CHECK (LENGTH(TRIM(idempotency_key)) > 0),
  CHECK (
    authorization_mode = 'staff_approved'
    AND approval_id IS NOT NULL
    AND revision_kind IN ('staff_submit', 'staff_resubmit', 'admin_edit')
    OR
    authorization_mode = 'admin_direct'
    AND approval_id IS NULL
    AND revision_kind = 'admin_direct'
  ),
  CHECK (
    status = 'pending'
    AND completed_at IS NULL
    OR
    status = 'processing'
    AND completed_at IS NULL
    AND next_attempt_at IS NULL
    OR
    status = 'accepted'
    AND completed_at IS NOT NULL
    AND next_attempt_at IS NULL
    OR
    status = 'failed'
    AND completed_at IS NOT NULL
    AND next_attempt_at IS NULL
    OR
    status = 'dispatch_uncertain'
    AND completed_at IS NOT NULL
    AND next_attempt_at IS NULL
  ),
  CHECK (
    status = 'pending'
    OR
    next_attempt_at IS NULL
  )
);

INSERT INTO mail_send_operations_new (
  id,
  outbound_revision_id,
  revision_chain_id,
  content_hash,
  hash_version,
  revision_kind,
  authorization_mode,
  approval_id,
  idempotency_key,
  status,
  orchestration_version,
  initiated_by_user_id,
  created_at,
  completed_at,
  next_attempt_at
)
SELECT
  id,
  outbound_revision_id,
  revision_chain_id,
  content_hash,
  hash_version,
  revision_kind,
  authorization_mode,
  approval_id,
  idempotency_key,
  status,
  orchestration_version,
  initiated_by_user_id,
  created_at,
  completed_at,
  next_attempt_at
FROM mail_send_operations;

CREATE UNIQUE INDEX uq_mail_send_operations_new_outbound_revision_id
  ON mail_send_operations_new (outbound_revision_id);

CREATE UNIQUE INDEX uq_mail_send_operations_new_idempotency_key
  ON mail_send_operations_new (idempotency_key);

CREATE UNIQUE INDEX uq_mail_send_operations_new_id_outbound_revision_id
  ON mail_send_operations_new (id, outbound_revision_id);

-- ---------------------------------------------------------------------------
-- mail_transport_attempts — extend state CHECK with ambiguous
-- ---------------------------------------------------------------------------
CREATE TABLE mail_transport_attempts_new (
  id TEXT PRIMARY KEY NOT NULL,
  send_operation_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  state TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_request_id TEXT,
  provider_message_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  retry_after_at TEXT,
  error_code TEXT,
  error_message TEXT,
  FOREIGN KEY (send_operation_id) REFERENCES mail_send_operations_new (id),
  CHECK (attempt_number >= 1),
  CHECK (
    state IN (
      'started',
      'accepted',
      'temporary_failure',
      'permanent_failure',
      'ambiguous'
    )
  ),
  CHECK (LENGTH(TRIM(provider)) > 0),
  CHECK (
    state = 'started'
    AND completed_at IS NULL
    OR
    state IN (
      'accepted',
      'temporary_failure',
      'permanent_failure',
      'ambiguous'
    )
    AND completed_at IS NOT NULL
  ),
  CHECK (
    state = 'temporary_failure'
    OR
    retry_after_at IS NULL
  )
);

INSERT INTO mail_transport_attempts_new (
  id,
  send_operation_id,
  attempt_number,
  state,
  provider,
  provider_request_id,
  provider_message_id,
  started_at,
  completed_at,
  retry_after_at,
  error_code,
  error_message
)
SELECT
  id,
  send_operation_id,
  attempt_number,
  state,
  provider,
  provider_request_id,
  provider_message_id,
  started_at,
  completed_at,
  retry_after_at,
  error_code,
  error_message
FROM mail_transport_attempts;

CREATE UNIQUE INDEX uq_mail_transport_attempts_new_send_operation_attempt_number
  ON mail_transport_attempts_new (send_operation_id, attempt_number);

CREATE UNIQUE INDEX uq_mail_transport_attempts_new_id_send_operation_id
  ON mail_transport_attempts_new (id, send_operation_id);

-- ---------------------------------------------------------------------------
-- mail_outbound_rfc_identities — repoint FK to mail_send_operations_new
-- ---------------------------------------------------------------------------
CREATE TABLE mail_outbound_rfc_identities_new (
  id TEXT PRIMARY KEY NOT NULL,
  send_operation_id TEXT NOT NULL,
  outbound_revision_id TEXT NOT NULL,
  rfc_message_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (send_operation_id) REFERENCES mail_send_operations_new (id),
  FOREIGN KEY (outbound_revision_id) REFERENCES mail_outbound_revisions (id),
  FOREIGN KEY (
    send_operation_id,
    outbound_revision_id
  ) REFERENCES mail_send_operations_new (
    id,
    outbound_revision_id
  ),
  CHECK (LENGTH(TRIM(rfc_message_id)) > 0)
);

INSERT INTO mail_outbound_rfc_identities_new (
  id,
  send_operation_id,
  outbound_revision_id,
  rfc_message_id,
  created_at
)
SELECT
  id,
  send_operation_id,
  outbound_revision_id,
  rfc_message_id,
  created_at
FROM mail_outbound_rfc_identities;

CREATE UNIQUE INDEX uq_mail_outbound_rfc_identities_new_send_operation_id
  ON mail_outbound_rfc_identities_new (send_operation_id);

CREATE UNIQUE INDEX uq_mail_outbound_rfc_identities_new_id_send_operation_rfc_message_id
  ON mail_outbound_rfc_identities_new (id, send_operation_id, rfc_message_id);

-- ---------------------------------------------------------------------------
-- mail_delivery_events — repoint FK to *_new parents
-- ---------------------------------------------------------------------------
CREATE TABLE mail_delivery_events_new (
  id TEXT PRIMARY KEY NOT NULL,
  send_operation_id TEXT NOT NULL,
  transport_attempt_id TEXT NOT NULL,
  outbound_revision_id TEXT NOT NULL,
  outbound_revision_recipient_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_dedupe_key TEXT NOT NULL,
  provider_event_id TEXT,
  provider_occurred_at TEXT,
  received_at TEXT NOT NULL,
  smtp_status_code TEXT,
  smtp_enhanced_status_code TEXT,
  diagnostic_message TEXT,
  FOREIGN KEY (send_operation_id) REFERENCES mail_send_operations_new (id),
  FOREIGN KEY (transport_attempt_id) REFERENCES mail_transport_attempts_new (id),
  FOREIGN KEY (outbound_revision_id) REFERENCES mail_outbound_revisions (id),
  FOREIGN KEY (outbound_revision_recipient_id) REFERENCES mail_outbound_revision_recipients (id),
  FOREIGN KEY (
    send_operation_id,
    outbound_revision_id
  ) REFERENCES mail_send_operations_new (
    id,
    outbound_revision_id
  ),
  FOREIGN KEY (
    transport_attempt_id,
    send_operation_id
  ) REFERENCES mail_transport_attempts_new (
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
  CHECK (event_type IN ('deferred', 'delivered', 'bounced')),
  CHECK (LENGTH(TRIM(event_dedupe_key)) > 0),
  CHECK (
    provider_event_id IS NULL
    OR LENGTH(TRIM(provider_event_id)) > 0
  ),
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
  )
);

INSERT INTO mail_delivery_events_new (
  id,
  send_operation_id,
  transport_attempt_id,
  outbound_revision_id,
  outbound_revision_recipient_id,
  event_type,
  event_dedupe_key,
  provider_event_id,
  provider_occurred_at,
  received_at,
  smtp_status_code,
  smtp_enhanced_status_code,
  diagnostic_message
)
SELECT
  id,
  send_operation_id,
  transport_attempt_id,
  outbound_revision_id,
  outbound_revision_recipient_id,
  event_type,
  event_dedupe_key,
  provider_event_id,
  provider_occurred_at,
  received_at,
  smtp_status_code,
  smtp_enhanced_status_code,
  diagnostic_message
FROM mail_delivery_events;

CREATE UNIQUE INDEX uq_mail_delivery_events_new_id_event_type
  ON mail_delivery_events_new (id, event_type);

-- ---------------------------------------------------------------------------
-- mail_outbound_message_materializations — repoint FK to *_new parents
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
  FOREIGN KEY (send_operation_id) REFERENCES mail_send_operations_new (id),
  FOREIGN KEY (outbound_revision_id) REFERENCES mail_outbound_revisions (id),
  FOREIGN KEY (accepted_transport_attempt_id) REFERENCES mail_transport_attempts_new (id),
  FOREIGN KEY (outbound_rfc_identity_id) REFERENCES mail_outbound_rfc_identities_new (id),
  FOREIGN KEY (mail_message_id) REFERENCES mail_messages (id),
  FOREIGN KEY (
    send_operation_id,
    outbound_revision_id
  ) REFERENCES mail_send_operations_new (
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
  ) REFERENCES mail_transport_attempts_new (
    id,
    send_operation_id
  ),
  FOREIGN KEY (
    outbound_rfc_identity_id,
    send_operation_id,
    rfc_message_id
  ) REFERENCES mail_outbound_rfc_identities_new (
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
  wire_internet_message_id,
  mail_message_id,
  message_direction,
  materialized_at
FROM mail_outbound_message_materializations;

-- ---------------------------------------------------------------------------
-- mail_delivery_ingestion_events — repoint FK to *_new parents
-- ---------------------------------------------------------------------------
CREATE TABLE mail_delivery_ingestion_events_new (
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
  FOREIGN KEY (send_operation_id) REFERENCES mail_send_operations_new (id),
  FOREIGN KEY (transport_attempt_id) REFERENCES mail_transport_attempts_new (id),
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
  ) REFERENCES mail_send_operations_new (
    id,
    outbound_revision_id
  ),
  FOREIGN KEY (
    transport_attempt_id,
    send_operation_id
  ) REFERENCES mail_transport_attempts_new (
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

INSERT INTO mail_delivery_ingestion_events_new (
  id,
  ingestion_event_id,
  event_kind,
  recipient_address,
  delivery_event_type,
  provider_occurred_at,
  smtp_status_code,
  smtp_enhanced_status_code,
  diagnostic_message,
  send_operation_id,
  transport_attempt_id,
  outbound_revision_id,
  outbound_revision_recipient_id,
  correlated_at
)
SELECT
  id,
  ingestion_event_id,
  event_kind,
  recipient_address,
  delivery_event_type,
  provider_occurred_at,
  smtp_status_code,
  smtp_enhanced_status_code,
  diagnostic_message,
  send_operation_id,
  transport_attempt_id,
  outbound_revision_id,
  outbound_revision_recipient_id,
  correlated_at
FROM mail_delivery_ingestion_events;

CREATE UNIQUE INDEX uq_mail_delivery_ingestion_events_new_ingestion_event_id
  ON mail_delivery_ingestion_events_new (ingestion_event_id);

CREATE UNIQUE INDEX uq_mail_delivery_ingestion_events_new_ingestion_delivery_type
  ON mail_delivery_ingestion_events_new (ingestion_event_id, delivery_event_type);

-- ---------------------------------------------------------------------------
-- mail_delivery_event_materializations — repoint FK to *_new parents
-- ---------------------------------------------------------------------------
CREATE TABLE mail_delivery_event_materializations_new (
  id TEXT PRIMARY KEY NOT NULL,
  ingestion_event_id TEXT NOT NULL,
  delivery_event_id TEXT NOT NULL,
  event_dedupe_key TEXT NOT NULL,
  delivery_event_type TEXT NOT NULL,
  materialized_at TEXT NOT NULL,
  FOREIGN KEY (ingestion_event_id) REFERENCES mail_delivery_ingestion_events_new (ingestion_event_id),
  FOREIGN KEY (delivery_event_id) REFERENCES mail_delivery_events_new (id),
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
  ) REFERENCES mail_delivery_ingestion_events_new (
    ingestion_event_id,
    delivery_event_type
  ),
  FOREIGN KEY (
    delivery_event_id,
    delivery_event_type
  ) REFERENCES mail_delivery_events_new (
    id,
    event_type
  ),
  CHECK (LENGTH(TRIM(event_dedupe_key)) > 0),
  CHECK (delivery_event_type IN ('deferred', 'delivered', 'bounced'))
);

INSERT INTO mail_delivery_event_materializations_new (
  id,
  ingestion_event_id,
  delivery_event_id,
  event_dedupe_key,
  delivery_event_type,
  materialized_at
)
SELECT
  id,
  ingestion_event_id,
  delivery_event_id,
  event_dedupe_key,
  delivery_event_type,
  materialized_at
FROM mail_delivery_event_materializations;

-- ---------------------------------------------------------------------------
-- Swap tables (deepest children first)
-- ---------------------------------------------------------------------------
DROP TABLE mail_delivery_event_materializations;
DROP TABLE mail_delivery_ingestion_events;
DROP TABLE mail_outbound_message_materializations;
DROP TABLE mail_delivery_events;
DROP TABLE mail_outbound_rfc_identities;
DROP TABLE mail_transport_attempts;
DROP TABLE mail_send_operations;

ALTER TABLE mail_send_operations_new RENAME TO mail_send_operations;
ALTER TABLE mail_transport_attempts_new RENAME TO mail_transport_attempts;
ALTER TABLE mail_outbound_rfc_identities_new RENAME TO mail_outbound_rfc_identities;
ALTER TABLE mail_delivery_events_new RENAME TO mail_delivery_events;
ALTER TABLE mail_outbound_message_materializations_new
  RENAME TO mail_outbound_message_materializations;
ALTER TABLE mail_delivery_ingestion_events_new
  RENAME TO mail_delivery_ingestion_events;
ALTER TABLE mail_delivery_event_materializations_new
  RENAME TO mail_delivery_event_materializations;

-- ---------------------------------------------------------------------------
-- Indexes — mail_send_operations
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_mail_send_operations_outbound_revision_id
  ON mail_send_operations (outbound_revision_id);

CREATE UNIQUE INDEX uq_mail_send_operations_idempotency_key
  ON mail_send_operations (idempotency_key);

CREATE INDEX idx_mail_send_operations_status_next_attempt_at
  ON mail_send_operations (status, next_attempt_at);

CREATE INDEX idx_mail_send_operations_approval_id
  ON mail_send_operations (approval_id);

CREATE INDEX idx_mail_send_operations_initiated_by_user_id
  ON mail_send_operations (initiated_by_user_id);

CREATE INDEX idx_mail_send_operations_revision_chain_id
  ON mail_send_operations (revision_chain_id);

CREATE UNIQUE INDEX uq_mail_send_operations_id_outbound_revision_id
  ON mail_send_operations (id, outbound_revision_id);

-- ---------------------------------------------------------------------------
-- Indexes — mail_transport_attempts
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_mail_transport_attempts_send_operation_attempt_number
  ON mail_transport_attempts (send_operation_id, attempt_number);

CREATE UNIQUE INDEX uq_mail_transport_attempts_one_started_per_send_operation
  ON mail_transport_attempts (send_operation_id)
  WHERE state = 'started';

CREATE INDEX idx_mail_transport_attempts_send_operation_started_at
  ON mail_transport_attempts (send_operation_id, started_at);

CREATE INDEX idx_mail_transport_attempts_state
  ON mail_transport_attempts (state);

CREATE INDEX idx_mail_transport_attempts_provider_message_id
  ON mail_transport_attempts (provider_message_id);

CREATE UNIQUE INDEX uq_mail_transport_attempts_id_send_operation_id
  ON mail_transport_attempts (id, send_operation_id);

-- ---------------------------------------------------------------------------
-- Indexes — mail_outbound_rfc_identities
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_mail_outbound_rfc_identities_send_operation_id
  ON mail_outbound_rfc_identities (send_operation_id);

CREATE UNIQUE INDEX uq_mail_outbound_rfc_identities_rfc_message_id
  ON mail_outbound_rfc_identities (rfc_message_id);

CREATE UNIQUE INDEX uq_mail_outbound_rfc_identities_id_send_operation_id
  ON mail_outbound_rfc_identities (id, send_operation_id);

CREATE UNIQUE INDEX uq_mail_outbound_rfc_identities_id_send_operation_rfc_message_id
  ON mail_outbound_rfc_identities (id, send_operation_id, rfc_message_id);

CREATE INDEX idx_mail_outbound_rfc_identities_outbound_revision_id
  ON mail_outbound_rfc_identities (outbound_revision_id);

-- ---------------------------------------------------------------------------
-- Indexes — mail_delivery_events
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_mail_delivery_events_event_dedupe_key
  ON mail_delivery_events (event_dedupe_key);

CREATE INDEX idx_mail_delivery_events_send_operation_received_at
  ON mail_delivery_events (send_operation_id, received_at);

CREATE INDEX idx_mail_delivery_events_recipient_received_at
  ON mail_delivery_events (outbound_revision_recipient_id, received_at);

CREATE INDEX idx_mail_delivery_events_transport_attempt_id
  ON mail_delivery_events (transport_attempt_id);

CREATE INDEX idx_mail_delivery_events_event_type_received_at
  ON mail_delivery_events (event_type, received_at);

CREATE INDEX idx_mail_delivery_events_provider_event_id
  ON mail_delivery_events (provider_event_id);

CREATE UNIQUE INDEX uq_mail_delivery_events_id_event_type
  ON mail_delivery_events (id, event_type);

-- ---------------------------------------------------------------------------
-- Indexes — mail_outbound_message_materializations
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Indexes — mail_delivery_ingestion_events
-- ---------------------------------------------------------------------------
CREATE INDEX idx_mail_delivery_ingestion_events_send_operation_id
  ON mail_delivery_ingestion_events (send_operation_id);

CREATE INDEX idx_mail_delivery_ingestion_events_transport_attempt_id
  ON mail_delivery_ingestion_events (transport_attempt_id);

CREATE INDEX idx_mail_delivery_ingestion_events_recipient_address
  ON mail_delivery_ingestion_events (recipient_address);

-- ---------------------------------------------------------------------------
-- Indexes — mail_delivery_event_materializations
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_mail_delivery_event_materializations_ingestion_event_id
  ON mail_delivery_event_materializations (ingestion_event_id);

CREATE UNIQUE INDEX uq_mail_delivery_event_materializations_delivery_event_id
  ON mail_delivery_event_materializations (delivery_event_id);
