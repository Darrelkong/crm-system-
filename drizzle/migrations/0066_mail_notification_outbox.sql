-- Phase 2C.12B.1 / 0066: Durable notification outbox + attempt history
-- ADDITIVE ONLY. Depends on 0052–0065.
--
-- Purpose: secondary external notification intent queue with transport attempt
--   provenance, processing lease, and semantic idempotency.
--
-- V1 processing lease: 15 minutes (service layer — NOT stored as duration column).
--
-- Do NOT alter 0052–0065. Do NOT add unrelated columns.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- mail_notification_outbox — durable notification intent (NOT transport)
-- ---------------------------------------------------------------------------
CREATE TABLE mail_notification_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  notification_type TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  notification_identity_id TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  mailbox_id TEXT,
  status TEXT NOT NULL,
  processing_version INTEGER NOT NULL DEFAULT 1,
  processing_started_at TEXT,
  processing_lease_expires_at TEXT,
  next_attempt_at TEXT,
  failure_code TEXT,
  enqueued_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (recipient_user_id) REFERENCES users (id),
  FOREIGN KEY (notification_identity_id) REFERENCES mail_notification_identities (id),
  FOREIGN KEY (mailbox_id) REFERENCES mail_mailboxes (id),
  CHECK (
    notification_type IN (
      'new_incoming',
      'approval_returned',
      'shared_assigned',
      'important_send_failure'
    )
  ),
  CHECK (LENGTH(TRIM(source_entity_type)) > 0),
  CHECK (LENGTH(TRIM(source_entity_id)) > 0),
  CHECK (
    status IN (
      'pending',
      'processing',
      'sent',
      'failed_retryable',
      'failed_permanent'
    )
  ),
  CHECK (processing_version >= 1),
  CHECK (
    NOT (
      (processing_started_at IS NULL AND processing_lease_expires_at IS NOT NULL)
      OR (processing_started_at IS NOT NULL AND processing_lease_expires_at IS NULL)
    )
  ),
  CHECK (
    (status = 'pending'
      AND processing_started_at IS NULL
      AND processing_lease_expires_at IS NULL
      AND completed_at IS NULL
      AND failure_code IS NULL
      AND next_attempt_at IS NULL)
    OR
    (status = 'processing'
      AND processing_started_at IS NOT NULL
      AND processing_lease_expires_at IS NOT NULL
      AND processing_lease_expires_at > processing_started_at
      AND completed_at IS NULL
      AND failure_code IS NULL
      AND next_attempt_at IS NULL)
    OR
    (status = 'failed_retryable'
      AND processing_started_at IS NULL
      AND processing_lease_expires_at IS NULL
      AND completed_at IS NULL
      AND next_attempt_at IS NOT NULL
      AND failure_code IS NOT NULL)
    OR
    (status = 'sent'
      AND processing_started_at IS NULL
      AND processing_lease_expires_at IS NULL
      AND next_attempt_at IS NULL
      AND completed_at IS NOT NULL
      AND failure_code IS NULL)
    OR
    (status = 'failed_permanent'
      AND processing_started_at IS NULL
      AND processing_lease_expires_at IS NULL
      AND next_attempt_at IS NULL
      AND completed_at IS NOT NULL
      AND failure_code IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_mail_notification_outbox_semantic_dedupe
  ON mail_notification_outbox (
    notification_type,
    source_entity_type,
    source_entity_id,
    recipient_user_id
  );

CREATE INDEX idx_mail_notification_outbox_status_next_attempt
  ON mail_notification_outbox (status, next_attempt_at);

CREATE INDEX idx_mail_notification_outbox_recipient_enqueued
  ON mail_notification_outbox (recipient_user_id, enqueued_at);

CREATE INDEX idx_mail_notification_outbox_notification_identity
  ON mail_notification_outbox (notification_identity_id);

CREATE INDEX idx_mail_notification_outbox_status_lease_expires
  ON mail_notification_outbox (status, processing_lease_expires_at);

-- ---------------------------------------------------------------------------
-- mail_notification_attempts — append-only transport attempt provenance
-- ---------------------------------------------------------------------------
CREATE TABLE mail_notification_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  notification_outbox_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  processing_version INTEGER NOT NULL,
  state TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_request_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  FOREIGN KEY (notification_outbox_id) REFERENCES mail_notification_outbox (id),
  CHECK (attempt_number >= 1),
  CHECK (processing_version >= 1),
  CHECK (LENGTH(TRIM(provider)) > 0),
  CHECK (
    state IN (
      'started',
      'accepted',
      'temporary_failure',
      'permanent_failure',
      'outcome_unknown'
    )
  ),
  CHECK (
    (state = 'started'
      AND completed_at IS NULL
      AND error_code IS NULL
      AND error_message IS NULL)
    OR
    (state = 'accepted'
      AND completed_at IS NOT NULL)
    OR
    (state = 'temporary_failure'
      AND completed_at IS NOT NULL
      AND error_code IS NOT NULL)
    OR
    (state = 'permanent_failure'
      AND completed_at IS NOT NULL
      AND error_code IS NOT NULL)
    OR
    (state = 'outcome_unknown'
      AND completed_at IS NOT NULL
      AND error_code = 'transport_outcome_unknown')
  ),
  CHECK (
    provider_request_id IS NULL
    OR LENGTH(TRIM(provider_request_id)) > 0
  )
);

CREATE UNIQUE INDEX uq_mail_notification_attempts_outbox_attempt_number
  ON mail_notification_attempts (notification_outbox_id, attempt_number);

CREATE UNIQUE INDEX uq_mail_notification_attempts_one_started_per_outbox
  ON mail_notification_attempts (notification_outbox_id)
  WHERE state = 'started';

CREATE INDEX idx_mail_notification_attempts_outbox_started_at
  ON mail_notification_attempts (notification_outbox_id, started_at);

CREATE INDEX idx_mail_notification_attempts_state
  ON mail_notification_attempts (state);
