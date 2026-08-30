-- Phase 2A / 2A.1: Large Attachment lifecycle + delivery_mode extension
-- CLASSIFICATION: DATA-PRESERVING SCHEMA REBUILD (SQLite table rebuild + INSERT…SELECT)
-- ADDITIVE ONLY. Depends on 0055 (attachment storage) and prior mail migrations.
--
-- Operational note: this is NOT a trivial ALTER. Three attachment usage tables are rebuilt
-- to extend delivery_mode CHECK constraints. Row data is preserved via INSERT…SELECT, but
-- deploy still requires migration-window planning and local parity validation.
--
-- Extends delivery_mode CHECK on attachment usage tables to include large_attachment.
-- Adds mail_large_attachment_lifecycle (one row per stored_file_id for V1).
-- Adds mail_large_attachment_upload_sessions (persistent authorize/finalize boundary).
--
-- Does NOT create R2 bucket, CORS, DNS, Workers, or presigned upload endpoints.
-- Local migration only until explicit Production rollout gate.
--
-- Cardinality: UNIQUE (stored_file_id) — V1 large uploads get a unique blob identity;
--   no implicit reuse across independent compose/send flows.
--
-- download_token_hash: SHA-256 hex verifier only — never persist raw bearer token.
--
-- declared_content_hash: client-declared SHA-256 fingerprint — NOT server-verified SHA-256
--   unless Phase 2B R2 checksum proof establishes equivalence.
-- storage_version / storage_etag: authoritative R2 object identity at finalize — distinct
--   from content_hash and from each other. Do NOT treat ETag as SHA-256 content_hash.

-- Rebuild order (FK audit):
--   1. mail_draft_attachments
--   2. mail_message_attachments (drop composite revision FK temporarily)
--   3. mail_outbound_revision_attachments
--   4. mail_message_attachments (restore composite revision FK)
--
-- D1-compatible FK semantics: defer_foreign_keys only (see 0068 pattern).

PRAGMA defer_foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- mail_draft_attachments — extend delivery_mode (table rebuild preserves rows)
-- ---------------------------------------------------------------------------
CREATE TABLE mail_draft_attachments_new (
  id TEXT PRIMARY KEY NOT NULL,
  draft_id TEXT NOT NULL,
  stored_file_id TEXT NOT NULL,
  display_filename TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  delivery_mode TEXT NOT NULL,
  secure_expiry_days INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES mail_drafts (id),
  FOREIGN KEY (stored_file_id) REFERENCES mail_stored_files (id),
  CHECK (delivery_mode IN ('direct_attachment', 'secure_file', 'large_attachment')),
  CHECK (length(trim(display_filename)) > 0),
  CHECK (
    (delivery_mode = 'direct_attachment' AND secure_expiry_days IS NULL)
    OR
    (delivery_mode = 'large_attachment' AND secure_expiry_days IS NULL)
    OR
    (delivery_mode = 'secure_file'
      AND secure_expiry_days IS NOT NULL
      AND secure_expiry_days IN (1, 3, 7))
  )
);

INSERT INTO mail_draft_attachments_new
SELECT * FROM mail_draft_attachments;

DROP TABLE mail_draft_attachments;

ALTER TABLE mail_draft_attachments_new RENAME TO mail_draft_attachments;

CREATE INDEX idx_mail_draft_attachments_draft_id
  ON mail_draft_attachments (draft_id);

-- ---------------------------------------------------------------------------
-- mail_message_attachments — pass 1: extend delivery_mode (revision FK deferred)
-- ---------------------------------------------------------------------------
CREATE TABLE mail_message_attachments_new (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL,
  stored_file_id TEXT NOT NULL,
  source_revision_attachment_id TEXT,
  content_hash TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  display_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  delivery_mode TEXT NOT NULL,
  secure_expiry_days INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES mail_messages (id),
  FOREIGN KEY (stored_file_id, content_hash)
    REFERENCES mail_stored_files (id, content_hash),
  CHECK (delivery_mode IN ('direct_attachment', 'secure_file', 'large_attachment')),
  CHECK (size_bytes >= 0),
  CHECK (length(trim(original_filename)) > 0),
  CHECK (length(trim(display_filename)) > 0),
  CHECK (
    (delivery_mode = 'direct_attachment' AND secure_expiry_days IS NULL)
    OR
    (delivery_mode = 'large_attachment' AND secure_expiry_days IS NULL)
    OR
    (delivery_mode = 'secure_file'
      AND secure_expiry_days IS NOT NULL
      AND secure_expiry_days IN (1, 3, 7))
  )
);

INSERT INTO mail_message_attachments_new
SELECT * FROM mail_message_attachments;

DROP TABLE mail_message_attachments;

ALTER TABLE mail_message_attachments_new RENAME TO mail_message_attachments;

CREATE INDEX idx_mail_message_attachments_message_id
  ON mail_message_attachments (message_id);

CREATE INDEX idx_mail_message_attachments_stored_file_id
  ON mail_message_attachments (stored_file_id);

CREATE INDEX idx_mail_message_attachments_source_revision_attachment
  ON mail_message_attachments (source_revision_attachment_id);

-- ---------------------------------------------------------------------------
-- mail_outbound_revision_attachments — extend delivery_mode
-- ---------------------------------------------------------------------------
CREATE TABLE mail_outbound_revision_attachments_new (
  id TEXT PRIMARY KEY NOT NULL,
  revision_id TEXT NOT NULL,
  stored_file_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  display_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  delivery_mode TEXT NOT NULL,
  secure_expiry_days INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (revision_id) REFERENCES mail_outbound_revisions (id),
  FOREIGN KEY (stored_file_id, content_hash)
    REFERENCES mail_stored_files (id, content_hash),
  CHECK (delivery_mode IN ('direct_attachment', 'secure_file', 'large_attachment')),
  CHECK (size_bytes >= 0),
  CHECK (length(trim(original_filename)) > 0),
  CHECK (length(trim(display_filename)) > 0),
  CHECK (
    (delivery_mode = 'direct_attachment' AND secure_expiry_days IS NULL)
    OR
    (delivery_mode = 'large_attachment' AND secure_expiry_days IS NULL)
    OR
    (delivery_mode = 'secure_file'
      AND secure_expiry_days IS NOT NULL
      AND secure_expiry_days IN (1, 3, 7))
  ),
  UNIQUE (id, stored_file_id, content_hash)
);

INSERT INTO mail_outbound_revision_attachments_new
SELECT * FROM mail_outbound_revision_attachments;

DROP TABLE mail_outbound_revision_attachments;

ALTER TABLE mail_outbound_revision_attachments_new
  RENAME TO mail_outbound_revision_attachments;

CREATE INDEX idx_mail_outbound_revision_attachments_revision_id
  ON mail_outbound_revision_attachments (revision_id);

CREATE INDEX idx_mail_outbound_revision_attachments_stored_file_id
  ON mail_outbound_revision_attachments (stored_file_id);

-- ---------------------------------------------------------------------------
-- mail_message_attachments — pass 2: restore composite revision FK
-- ---------------------------------------------------------------------------
CREATE TABLE mail_message_attachments_new (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL,
  stored_file_id TEXT NOT NULL,
  source_revision_attachment_id TEXT,
  content_hash TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  display_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  delivery_mode TEXT NOT NULL,
  secure_expiry_days INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES mail_messages (id),
  FOREIGN KEY (stored_file_id, content_hash)
    REFERENCES mail_stored_files (id, content_hash),
  FOREIGN KEY (source_revision_attachment_id, stored_file_id, content_hash)
    REFERENCES mail_outbound_revision_attachments (id, stored_file_id, content_hash),
  CHECK (delivery_mode IN ('direct_attachment', 'secure_file', 'large_attachment')),
  CHECK (size_bytes >= 0),
  CHECK (length(trim(original_filename)) > 0),
  CHECK (length(trim(display_filename)) > 0),
  CHECK (
    (delivery_mode = 'direct_attachment' AND secure_expiry_days IS NULL)
    OR
    (delivery_mode = 'large_attachment' AND secure_expiry_days IS NULL)
    OR
    (delivery_mode = 'secure_file'
      AND secure_expiry_days IS NOT NULL
      AND secure_expiry_days IN (1, 3, 7))
  )
);

INSERT INTO mail_message_attachments_new
SELECT * FROM mail_message_attachments;

DROP TABLE mail_message_attachments;

ALTER TABLE mail_message_attachments_new RENAME TO mail_message_attachments;

CREATE INDEX idx_mail_message_attachments_message_id
  ON mail_message_attachments (message_id);

CREATE INDEX idx_mail_message_attachments_stored_file_id
  ON mail_message_attachments (stored_file_id);

CREATE INDEX idx_mail_message_attachments_source_revision_attachment
  ON mail_message_attachments (source_revision_attachment_id);

-- ---------------------------------------------------------------------------
-- mail_large_attachment_lifecycle — Large Attachment state + download verifier
-- ---------------------------------------------------------------------------
CREATE TABLE mail_large_attachment_lifecycle (
  id TEXT PRIMARY KEY NOT NULL,
  stored_file_id TEXT NOT NULL,
  status TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  temporary_expires_at TEXT,
  approval_hold_started_at TEXT,
  approval_absolute_expires_at TEXT,
  sent_at TEXT,
  recipient_expires_at TEXT,
  deleted_at TEXT,
  delete_reason TEXT,
  download_token_hash TEXT,
  download_count INTEGER NOT NULL DEFAULT 0,
  last_downloaded_at TEXT,
  declared_content_hash TEXT,
  storage_version TEXT,
  storage_etag TEXT,
  finalized_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (stored_file_id) REFERENCES mail_stored_files (id),
  CHECK (status IN ('temporary', 'approval_hold', 'sent', 'expired', 'deleted', 'revoked')),
  CHECK (download_count >= 0),
  CHECK (
    declared_content_hash IS NULL
    OR (
      length(declared_content_hash) = 64
      AND declared_content_hash = lower(declared_content_hash)
      AND declared_content_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (
    (status = 'temporary'
      AND temporary_expires_at IS NOT NULL
      AND approval_hold_started_at IS NULL
      AND approval_absolute_expires_at IS NULL
      AND sent_at IS NULL
      AND recipient_expires_at IS NULL
      AND download_token_hash IS NULL
      AND finalized_at IS NOT NULL
      AND declared_content_hash IS NOT NULL
      AND storage_version IS NOT NULL
      AND storage_etag IS NOT NULL)
    OR
    (status = 'approval_hold'
      AND approval_hold_started_at IS NOT NULL
      AND approval_absolute_expires_at IS NOT NULL
      AND sent_at IS NULL
      AND recipient_expires_at IS NULL
      AND download_token_hash IS NULL
      AND finalized_at IS NOT NULL
      AND declared_content_hash IS NOT NULL
      AND storage_version IS NOT NULL
      AND storage_etag IS NOT NULL)
    OR
    (status = 'sent'
      AND sent_at IS NOT NULL
      AND recipient_expires_at IS NOT NULL
      AND download_token_hash IS NOT NULL
      AND finalized_at IS NOT NULL
      AND declared_content_hash IS NOT NULL
      AND storage_version IS NOT NULL
      AND storage_etag IS NOT NULL)
    OR
    (status IN ('expired', 'deleted', 'revoked'))
  )
);

CREATE UNIQUE INDEX uq_mail_large_attachment_lifecycle_stored_file_id
  ON mail_large_attachment_lifecycle (stored_file_id);

CREATE UNIQUE INDEX uq_mail_large_attachment_lifecycle_download_token_hash
  ON mail_large_attachment_lifecycle (download_token_hash);

CREATE INDEX idx_mail_large_attachment_lifecycle_status_temporary_expires
  ON mail_large_attachment_lifecycle (status, temporary_expires_at);

CREATE INDEX idx_mail_large_attachment_lifecycle_status_approval_absolute
  ON mail_large_attachment_lifecycle (status, approval_absolute_expires_at);

CREATE INDEX idx_mail_large_attachment_lifecycle_status_recipient_expires
  ON mail_large_attachment_lifecycle (status, recipient_expires_at);

-- ---------------------------------------------------------------------------
-- mail_large_attachment_upload_sessions — persistent authorize/finalize boundary
--
-- Cross-request upload flow MUST NOT rely on ephemeral Worker memory.
-- Do NOT persist presigned PUT URL, signing secrets, or R2 credentials.
--
-- declared_content_hash: client-computed SHA-256 fingerprint at authorize time.
-- storage_key: server-generated unique object key — UNIQUE globally.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_large_attachment_upload_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  mailbox_id TEXT NOT NULL,
  stored_file_id TEXT,
  storage_key TEXT NOT NULL,
  expected_filename TEXT NOT NULL,
  expected_mime_type TEXT NOT NULL,
  expected_size_bytes INTEGER NOT NULL,
  max_size_bytes INTEGER NOT NULL,
  declared_content_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  finalized_at TEXT,
  invalidated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users (id),
  FOREIGN KEY (draft_id) REFERENCES mail_drafts (id),
  FOREIGN KEY (mailbox_id) REFERENCES mail_mailboxes (id),
  FOREIGN KEY (stored_file_id) REFERENCES mail_stored_files (id),
  CHECK (expected_size_bytes > 0),
  CHECK (max_size_bytes > 0),
  CHECK (expected_size_bytes <= max_size_bytes),
  CHECK (length(trim(expected_filename)) > 0),
  CHECK (
    length(declared_content_hash) = 64
    AND declared_content_hash = lower(declared_content_hash)
    AND declared_content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    (finalized_at IS NULL AND invalidated_at IS NULL)
    OR (finalized_at IS NOT NULL AND invalidated_at IS NULL)
    OR (finalized_at IS NULL AND invalidated_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_mail_large_attachment_upload_sessions_storage_key
  ON mail_large_attachment_upload_sessions (storage_key);

CREATE INDEX idx_mail_large_attachment_upload_sessions_draft_id
  ON mail_large_attachment_upload_sessions (draft_id);

CREATE INDEX idx_mail_large_attachment_upload_sessions_actor_draft
  ON mail_large_attachment_upload_sessions (actor_user_id, draft_id);

CREATE INDEX idx_mail_large_attachment_upload_sessions_expires_at
  ON mail_large_attachment_upload_sessions (expires_at);
