-- Phase 2C2.2: durable crash-safe Large Attachment delivery capabilities.
--
-- CREATE-only additive migration. Existing tables and business rows are
-- intentionally left untouched. The raw recipient token is never stored.

CREATE TABLE mail_large_attachment_delivery_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  lifecycle_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  send_operation_id TEXT NOT NULL,
  transport_attempt_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  armed_at TEXT,
  confirmed_at TEXT,
  revoked_at TEXT,
  provider_message_id TEXT,
  provider_accepted_at TEXT,
  FOREIGN KEY (lifecycle_id)
    REFERENCES mail_large_attachment_lifecycle (id),
  FOREIGN KEY (revision_id)
    REFERENCES mail_outbound_revisions (id),
  FOREIGN KEY (send_operation_id)
    REFERENCES mail_send_operations (id),
  FOREIGN KEY (transport_attempt_id)
    REFERENCES mail_transport_attempts (id),
  FOREIGN KEY (transport_attempt_id, send_operation_id)
    REFERENCES mail_transport_attempts (id, send_operation_id),
  CHECK (
    length(token_hash) = 64
    AND token_hash = lower(token_hash)
    AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    state IN ('prepared', 'armed', 'confirmed', 'revoked', 'expired')
  ),
  CHECK (length(trim(expires_at)) > 0),
  CHECK (length(trim(created_at)) > 0),
  CHECK (
    (state = 'prepared'
      AND armed_at IS NULL
      AND confirmed_at IS NULL
      AND revoked_at IS NULL
      AND provider_message_id IS NULL
      AND provider_accepted_at IS NULL)
    OR
    (state = 'armed'
      AND armed_at IS NOT NULL
      AND confirmed_at IS NULL
      AND revoked_at IS NULL
      AND provider_message_id IS NULL
      AND provider_accepted_at IS NULL)
    OR
    (state = 'confirmed'
      AND armed_at IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND revoked_at IS NULL
      AND length(trim(provider_message_id)) > 0
      AND provider_accepted_at IS NOT NULL)
    OR
    (state = 'revoked'
      AND revoked_at IS NOT NULL
      AND confirmed_at IS NULL
      AND provider_message_id IS NULL
      AND provider_accepted_at IS NULL)
    OR
    (state = 'expired'
      AND armed_at IS NOT NULL
      AND revoked_at IS NULL)
  )
);

CREATE UNIQUE INDEX uq_mail_large_attachment_delivery_tokens_active_lifecycle_revision_send
  ON mail_large_attachment_delivery_tokens (
    lifecycle_id,
    revision_id,
    send_operation_id
  )
  WHERE state IN ('prepared', 'armed', 'confirmed');

CREATE UNIQUE INDEX uq_mail_large_attachment_delivery_tokens_token_hash
  ON mail_large_attachment_delivery_tokens (token_hash);

CREATE INDEX idx_mail_large_attachment_delivery_tokens_state_expires
  ON mail_large_attachment_delivery_tokens (state, expires_at);

CREATE INDEX idx_mail_large_attachment_delivery_tokens_lifecycle
  ON mail_large_attachment_delivery_tokens (lifecycle_id);

CREATE INDEX idx_mail_large_attachment_delivery_tokens_send_operation
  ON mail_large_attachment_delivery_tokens (send_operation_id);

CREATE INDEX idx_mail_large_attachment_delivery_tokens_transport_attempt
  ON mail_large_attachment_delivery_tokens (transport_attempt_id);

CREATE INDEX idx_mail_large_attachment_delivery_tokens_provider_message
  ON mail_large_attachment_delivery_tokens (provider_message_id);
