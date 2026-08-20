-- Phase 2B.7: Mail attachment storage (stored files + draft/revision/message usage)
-- Phase 2B.7.1: Signature asset provenance + hash/scan hardening
-- ADDITIVE ONLY. No seed data. Depends on 0052, 0053, 0054.
--
-- Rollback policy: do NOT drop these tables as a normal rollback.
-- Stored files and attachment snapshots are correspondence history.
--
-- Physical file identity (mail_stored_files) is separate from attachment usage rows.
-- Global physical deduplication is NOT required in V1 — content_hash is NOT globally unique.
--
-- CANONICAL HASH V1 ALGORITHM: NOT YET FROZEN.
-- After Local D1 runtime verification, a separate gate will lock serialization rules.
-- Attachment + signature-asset hash INPUT fields exist; hash service not implemented.
--
-- Revision attachment canonical hash inputs (documented; service not implemented):
--   content_hash, display_filename, mime_type, size_bytes, sort_order,
--   delivery_mode, secure_expiry_days
-- EXCLUDED from external hash: stored_file_id, attachment row id, storage_provider,
--   storage_bucket, storage_key, created_by_user_id, security scan state.
-- original_filename is historical metadata — NOT hash input when only display_filename
-- is externally emitted.
--
-- Signature snapshot asset canonical hash inputs (documented; service not implemented):
--   asset_ref, content_hash, mime_type, size_bytes, deterministic sort_order
-- EXCLUDED: stored_file_id, storage_bucket, storage_key, database row IDs.
--
-- asset_refs_json (0054 Signature Version/Snapshot): presentation/editor metadata ONLY.
-- NOT authoritative for stored file identity, content hash, R2 key, or physical existence.
-- Authoritative physical asset mapping: mail_signature_version_assets,
--   mail_signature_snapshot_assets. No public/storage URLs in asset_refs_json.
--
-- Future atomic writes: use env.DB.batch([...]) — not D1Database.transaction().

-- ---------------------------------------------------------------------------
-- mail_stored_files — immutable physical file/blob identity
--
-- content_hash: SHA-256 lowercase hex (64 chars) of stored FILE BYTES — NOT globally unique.
-- Identical bytes may exist in multiple rows (no V1 global dedup / reference_count).
--
-- storage_key: private object identity — UNIQUE. No public_url / presigned_url columns.
-- Access later via authorized server APIs only.
--
-- security_scan_status: provider-neutral operational metadata — NOT file bytes, NOT hash input.
-- Scanning NOT implemented. Future APIs MUST enforce policy before exposing unsafe files.
-- Lifecycle: unscanned → scanned_at NULL; clean/blocked/scan_failed → scanned_at NOT NULL.
--
-- Message-specific fields (display_filename, delivery_mode, secure_expiry) belong on
-- attachment usage rows — NOT here.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_stored_files (
  id TEXT PRIMARY KEY NOT NULL,
  content_hash TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_provider TEXT NOT NULL,
  storage_bucket TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_by_user_id TEXT,
  security_scan_status TEXT NOT NULL DEFAULT 'unscanned',
  security_scanned_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (size_bytes >= 0),
  CHECK (storage_provider IN ('r2')),
  CHECK (security_scan_status IN ('unscanned', 'clean', 'blocked', 'scan_failed')),
  CHECK (length(trim(original_filename)) > 0),
  CHECK (
    length(content_hash) = 64
    AND content_hash = lower(content_hash)
    AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    (security_scan_status = 'unscanned' AND security_scanned_at IS NULL)
    OR
    (security_scan_status IN ('clean', 'blocked', 'scan_failed')
      AND security_scanned_at IS NOT NULL)
  ),
  UNIQUE (id, content_hash)
);

CREATE INDEX idx_mail_stored_files_content_hash
  ON mail_stored_files (content_hash);

CREATE UNIQUE INDEX uq_mail_stored_files_storage_key
  ON mail_stored_files (storage_key);

CREATE INDEX idx_mail_stored_files_created_by
  ON mail_stored_files (created_by_user_id);

-- ---------------------------------------------------------------------------
-- mail_draft_attachments — mutable working attachment usage on a Draft
--
-- display_filename: user-visible rename without changing stored bytes.
-- original_filename remains on mail_stored_files.
--
-- delivery_mode V1: direct_attachment | secure_file
-- secure_expiry_days: 1 | 3 | 7 when secure_file; NULL when direct_attachment.
-- Explicit IS NOT NULL on secure branch — NULL IN (...) is not a rejection in SQLite.
--
-- Mutable: add/remove/rename/reorder/switch delivery mode during compose.
-- NOT canonical send content — Revision snapshot is authoritative after submit.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_draft_attachments (
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
  CHECK (delivery_mode IN ('direct_attachment', 'secure_file')),
  CHECK (length(trim(display_filename)) > 0),
  CHECK (
    (delivery_mode = 'direct_attachment' AND secure_expiry_days IS NULL)
    OR
    (delivery_mode = 'secure_file'
      AND secure_expiry_days IS NOT NULL
      AND secure_expiry_days IN (1, 3, 7))
  )
);

CREATE INDEX idx_mail_draft_attachments_draft_id
  ON mail_draft_attachments (draft_id);

-- ---------------------------------------------------------------------------
-- mail_outbound_revision_attachments — immutable canonical attachment snapshot
--
-- Materialized at revision creation from stored file + draft attachment metadata.
-- Do NOT read mutable draft attachment rows at approval/send time after revision exists.
--
-- content_hash MUST match mail_stored_files bytes for stored_file_id (composite FK).
-- UNIQUE (id, stored_file_id, content_hash) supports message attachment lineage FK.
-- No updated_at. No approval/send/delivery state.
--
-- Same stored_file_id may appear on multiple revisions/messages — no global uniqueness.
-- Same stored_file_id may appear twice on one revision if product allows — no invented constraint.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_outbound_revision_attachments (
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
  CHECK (delivery_mode IN ('direct_attachment', 'secure_file')),
  CHECK (size_bytes >= 0),
  CHECK (length(trim(original_filename)) > 0),
  CHECK (length(trim(display_filename)) > 0),
  CHECK (
    (delivery_mode = 'direct_attachment' AND secure_expiry_days IS NULL)
    OR
    (delivery_mode = 'secure_file'
      AND secure_expiry_days IS NOT NULL
      AND secure_expiry_days IN (1, 3, 7))
  ),
  UNIQUE (id, stored_file_id, content_hash)
);

CREATE INDEX idx_mail_outbound_revision_attachments_revision_id
  ON mail_outbound_revision_attachments (revision_id);

CREATE INDEX idx_mail_outbound_revision_attachments_stored_file_id
  ON mail_outbound_revision_attachments (stored_file_id);

-- ---------------------------------------------------------------------------
-- mail_message_attachments — inbound + outbound materialized message attachments
--
-- Inbound: stored_file + message row; source_revision_attachment_id = NULL.
-- Outbound: materialized from revision attachment snapshot — copy frozen metadata exactly.
-- Do NOT substitute another Stored File at materialization time.
--
-- Composite FK (source_revision_attachment_id, stored_file_id, content_hash) ensures
-- outbound message rows cannot reference a revision attachment representing different bytes.
-- Future service MUST additionally ensure revision attachment belongs to the send revision
-- (cross-domain invariant — depends on future Send Operation schema).
--
-- secure_file rows preserve delivery_mode + secure_expiry_days at send time.
-- Token / public URL / download session / access logs: NOT in this migration.
--
-- Composite FK (stored_file_id, content_hash) prevents hash/file identity mismatch.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_message_attachments (
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
  CHECK (delivery_mode IN ('direct_attachment', 'secure_file')),
  CHECK (size_bytes >= 0),
  CHECK (length(trim(original_filename)) > 0),
  CHECK (length(trim(display_filename)) > 0),
  CHECK (
    (delivery_mode = 'direct_attachment' AND secure_expiry_days IS NULL)
    OR
    (delivery_mode = 'secure_file'
      AND secure_expiry_days IS NOT NULL
      AND secure_expiry_days IN (1, 3, 7))
  )
);

CREATE INDEX idx_mail_message_attachments_message_id
  ON mail_message_attachments (message_id);

CREATE INDEX idx_mail_message_attachments_stored_file_id
  ON mail_message_attachments (stored_file_id);

CREATE INDEX idx_mail_message_attachments_source_revision_attachment
  ON mail_message_attachments (source_revision_attachment_id);

-- ---------------------------------------------------------------------------
-- mail_signature_version_assets — image/file assets for one Signature Version
--
-- asset_ref: logical reference in sanitized Signature HTML (e.g. company-logo).
-- NOT an R2 storage key, public URL, signed URL, or download URL.
--
-- Composite FK (stored_file_id, content_hash) prevents hash/file identity mismatch.
-- UNIQUE (signature_version_id, asset_ref) per version.
-- Same image bytes may be reused across versions — content_hash NOT globally unique.
--
-- asset_refs_json on mail_signature_versions: presentation/editor metadata ONLY.
-- This table is authoritative for physical file provenance.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_signature_version_assets (
  id TEXT PRIMARY KEY NOT NULL,
  signature_version_id TEXT NOT NULL,
  stored_file_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  asset_ref TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (signature_version_id) REFERENCES mail_signature_versions (id),
  FOREIGN KEY (stored_file_id, content_hash)
    REFERENCES mail_stored_files (id, content_hash),
  CHECK (size_bytes >= 0),
  CHECK (length(trim(asset_ref)) > 0),
  UNIQUE (signature_version_id, asset_ref)
);

CREATE INDEX idx_mail_signature_version_assets_version_id
  ON mail_signature_version_assets (signature_version_id);

-- ---------------------------------------------------------------------------
-- mail_signature_snapshot_assets — immutable assets frozen into Signature Snapshot
--
-- Materialized at snapshot creation from mail_signature_version_assets.
-- Do NOT read live mail_signature_version_assets at Approval or Send time.
--
-- asset_ref: logical HTML reference frozen at snapshot time.
-- No updated_at. No public URL. No mutable lifecycle state.
--
-- Composite FK (stored_file_id, content_hash) → mail_stored_files.
-- UNIQUE (signature_snapshot_id, asset_ref) per snapshot.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_signature_snapshot_assets (
  id TEXT PRIMARY KEY NOT NULL,
  signature_snapshot_id TEXT NOT NULL,
  stored_file_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  asset_ref TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (signature_snapshot_id) REFERENCES mail_signature_snapshots (id),
  FOREIGN KEY (stored_file_id, content_hash)
    REFERENCES mail_stored_files (id, content_hash),
  CHECK (size_bytes >= 0),
  CHECK (length(trim(asset_ref)) > 0),
  UNIQUE (signature_snapshot_id, asset_ref)
);

CREATE INDEX idx_mail_signature_snapshot_assets_snapshot_id
  ON mail_signature_snapshot_assets (signature_snapshot_id);
