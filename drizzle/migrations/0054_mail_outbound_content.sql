-- Phase 2B.5: Mail outbound content formation (drafts, signatures, immutable revisions)
-- ADDITIVE ONLY. No seed data. Depends on 0052_mail_foundation.sql and 0053_mail_message_core.sql.
--
-- Rollback policy: do NOT drop these tables as a normal rollback.
-- Drafts, signature history, snapshots, and revisions are correspondence history.
--
-- Future atomic writes: use env.DB.batch([...]) — not D1Database.transaction().

-- ---------------------------------------------------------------------------
-- mail_drafts — mutable server-persisted compose working state
--
-- NOT canonical send/approval content. Blank ephemeral compose never creates a row
-- (service layer decides meaningful content before first persistence).
--
-- body_html is WORKING COPY — client editor HTML; NOT trusted/sanitized canonical HTML.
-- Server MUST sanitize when materializing mail_outbound_revisions.
--
-- Draft may be incomplete: nullable mailbox/sender/recipients/subject allowed.
-- Do NOT reuse outbound canonical CHECKs on mutable drafts.
--
-- reply/reply_all/forward normally have reply_to_message_id; service-layer invariant
-- when source message is temporarily unavailable during UI recovery.
--
-- Customer association CHECK: customer_associated_by_user_id is historical attribution
-- with ON DELETE SET NULL — it MAY be NULL when customer_id is set (auto-match or
-- deleted attribution user). type + associated_at are required when customer is set.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  author_user_id TEXT NOT NULL,
  mailbox_id TEXT,
  sender_identity_id TEXT,
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  sensitivity TEXT NOT NULL DEFAULT 'normal',
  compose_mode TEXT NOT NULL,
  reply_to_message_id TEXT,
  autosave_version INTEGER NOT NULL DEFAULT 0,
  last_saved_at TEXT NOT NULL,
  discarded_at TEXT,
  customer_id TEXT,
  customer_association_type TEXT,
  customer_associated_by_user_id TEXT,
  customer_associated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (author_user_id) REFERENCES users (id),
  FOREIGN KEY (mailbox_id) REFERENCES mail_mailboxes (id),
  FOREIGN KEY (sender_identity_id) REFERENCES mail_sender_identities (id),
  FOREIGN KEY (reply_to_message_id) REFERENCES mail_messages (id),
  FOREIGN KEY (customer_id) REFERENCES customers (id),
  FOREIGN KEY (customer_associated_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (sensitivity IN ('normal', 'sensitive', 'restricted')),
  CHECK (compose_mode IN ('new', 'reply', 'reply_all', 'forward')),
  CHECK (autosave_version >= 0),
  CHECK (
    (customer_id IS NULL
      AND customer_association_type IS NULL
      AND customer_associated_by_user_id IS NULL
      AND customer_associated_at IS NULL)
    OR
    (customer_id IS NOT NULL
      -- Explicit IS NOT NULL: NULL IN (...) evaluates unknown and CHECK passes in SQLite.
      AND customer_association_type IS NOT NULL
      AND customer_association_type IN ('auto_match', 'manual')
      AND customer_associated_at IS NOT NULL)
  )
);

CREATE INDEX idx_mail_drafts_author_discarded_updated
  ON mail_drafts (author_user_id, discarded_at, updated_at);

CREATE INDEX idx_mail_drafts_mailbox_id
  ON mail_drafts (mailbox_id);

-- ---------------------------------------------------------------------------
-- mail_draft_recipients — mutable To/Cc/Bcc working recipients
--
-- One normalized address per draft across ALL types (case-insensitive).
-- Submission minimum: >=1 unique recipient across To+Cc+Bcc (NOT To-specific) — service layer.
-- Max 50 unique recipients: service layer only.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_draft_recipients (
  id TEXT PRIMARY KEY NOT NULL,
  draft_id TEXT NOT NULL,
  recipient_type TEXT NOT NULL,
  address TEXT NOT NULL,
  display_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES mail_drafts (id),
  CHECK (recipient_type IN ('to', 'cc', 'bcc'))
);

CREATE INDEX idx_mail_draft_recipients_draft_id
  ON mail_draft_recipients (draft_id);

CREATE UNIQUE INDEX uq_mail_draft_recipients_draft_address
  ON mail_draft_recipients (draft_id, lower(address));

-- ---------------------------------------------------------------------------
-- mail_signature_versions — versioned admin-managed signature per Sender Identity
--
-- Signature belongs to Sender Identity (NOT CRM user, NOT mailbox).
-- Append-only versions; do not edit historical signature content in place.
-- One active version per Sender Identity (partial unique).
--
-- body_html_sanitized: canonical admin-managed sanitized HTML only.
-- asset_refs_json: metadata/future reference only — no R2 objects in this phase.
--
-- Lifecycle CHECK: active versions cannot be retired; retired versions cannot be active.
-- Inactive without retired_at is allowed (unpublished future workflow).
-- ---------------------------------------------------------------------------
CREATE TABLE mail_signature_versions (
  id TEXT PRIMARY KEY NOT NULL,
  sender_identity_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  body_text TEXT NOT NULL DEFAULT '',
  body_html_sanitized TEXT,
  asset_refs_json TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  retired_at TEXT,
  retired_by_user_id TEXT,
  FOREIGN KEY (sender_identity_id) REFERENCES mail_sender_identities (id),
  FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (retired_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (is_active IN (0, 1)),
  CHECK (version_number >= 1),
  CHECK (
    (is_active = 1 AND retired_at IS NULL)
    OR
    (is_active = 0)
  ),
  UNIQUE (id, sender_identity_id),
  UNIQUE (sender_identity_id, version_number)
);

CREATE INDEX idx_mail_signature_versions_sender_identity
  ON mail_signature_versions (sender_identity_id);

CREATE UNIQUE INDEX uq_mail_signature_versions_active_per_identity
  ON mail_signature_versions (sender_identity_id)
  WHERE is_active = 1;

-- ---------------------------------------------------------------------------
-- mail_signature_snapshots — immutable signature content captured for one revision
--
-- One outbound revision owns one dedicated snapshot (signature_snapshot_id UNIQUE
-- on mail_outbound_revisions). Snapshot rows are NOT reused across revisions.
-- snapshot_hash is NOT globally unique — two revisions may have identical content.
--
-- Composite FK (source_signature_version_id, sender_identity_id) ensures source
-- version belongs to the same Sender Identity when present. NULL source version
-- remains allowed (SQLite skips composite FK when version id is NULL).
--
-- UNIQUE (id, sender_identity_id) enables revision composite FK lineage enforcement.
--
-- Created BEFORE outbound revision content hash (locked future sequence):
--   1. Resolve Sender Identity
--   2. Resolve active Signature Version
--   3. Create immutable Signature Snapshot
--   4. Build immutable Outbound Revision
--   5. Compute revision content hash
--   6. Persist revision + recipients atomically
--
-- No updated_at — snapshot survives later signature version changes.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_signature_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  sender_identity_id TEXT NOT NULL,
  source_signature_version_id TEXT,
  body_text TEXT NOT NULL DEFAULT '',
  body_html_sanitized TEXT,
  asset_refs_json TEXT,
  snapshot_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (sender_identity_id) REFERENCES mail_sender_identities (id),
  FOREIGN KEY (source_signature_version_id, sender_identity_id)
    REFERENCES mail_signature_versions (id, sender_identity_id),
  UNIQUE (id, sender_identity_id)
);

CREATE INDEX idx_mail_signature_snapshots_sender_identity
  ON mail_signature_snapshots (sender_identity_id);

CREATE INDEX idx_mail_signature_snapshots_source_version
  ON mail_signature_snapshots (source_signature_version_id);

-- ---------------------------------------------------------------------------
-- mail_outbound_revisions — immutable generic outbound content (NOT approval-specific)
--
-- Append-only by domain rule. No updated_at. Service layer MUST NOT UPDATE content.
-- Approval workflow is a later wrapper pointing at revision ids.
--
-- content_hash / hash_version: schema placeholder — ATTACHMENT-AWARE FINAL HASH
-- CONTRACT NOT YET FROZEN. Future attachments WILL be hash inputs.
-- CRM customer association is NOT part of content_hash.
--
-- Intended non-attachment hash inputs (documented; service not implemented here):
--   mailbox_id, sender_identity_id, from_address, from_display_name, subject,
--   body_text, body_html_sanitized, sensitivity, compose_mode (when semantics apply),
--   normalized recipient snapshots, signature snapshot content/hash.
--
-- Revision chain structural CHECK (cross-chain parent match is service-layer):
--   revision_number = 1  -> parent_revision_id IS NULL
--   revision_number > 1  -> parent_revision_id IS NOT NULL
--
-- Composite FK (signature_snapshot_id, sender_identity_id) enforces:
--   revision.sender_identity_id = signature_snapshot.sender_identity_id
--
-- SECURITY-CRITICAL (service layer, NOT a live DB FK):
--   at revision creation, resolved Sender Identity address MUST equal from_address
--   being snapshotted. from_address is immutable historical content — do NOT FK
--   to mutable mail_sender_identities.address.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_outbound_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  revision_chain_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  parent_revision_id TEXT,
  source_draft_id TEXT,
  revision_kind TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  mailbox_id TEXT NOT NULL,
  sender_identity_id TEXT NOT NULL,
  from_address TEXT NOT NULL,
  from_display_name TEXT,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL DEFAULT '',
  body_html_sanitized TEXT,
  sensitivity TEXT NOT NULL DEFAULT 'normal',
  compose_mode TEXT NOT NULL,
  reply_to_message_id TEXT,
  signature_snapshot_id TEXT NOT NULL,
  customer_id TEXT,
  customer_association_type TEXT,
  customer_associated_by_user_id TEXT,
  customer_associated_at TEXT,
  content_hash TEXT NOT NULL,
  hash_version INTEGER NOT NULL,
  FOREIGN KEY (parent_revision_id) REFERENCES mail_outbound_revisions (id),
  FOREIGN KEY (source_draft_id) REFERENCES mail_drafts (id),
  FOREIGN KEY (created_by_user_id) REFERENCES users (id),
  FOREIGN KEY (mailbox_id) REFERENCES mail_mailboxes (id),
  FOREIGN KEY (sender_identity_id) REFERENCES mail_sender_identities (id),
  FOREIGN KEY (reply_to_message_id) REFERENCES mail_messages (id),
  FOREIGN KEY (signature_snapshot_id, sender_identity_id)
    REFERENCES mail_signature_snapshots (id, sender_identity_id),
  FOREIGN KEY (customer_id) REFERENCES customers (id),
  FOREIGN KEY (customer_associated_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (revision_kind IN ('staff_submit', 'staff_resubmit', 'admin_edit', 'admin_direct')),
  CHECK (revision_number >= 1),
  CHECK (
    (revision_number = 1 AND parent_revision_id IS NULL)
    OR
    (revision_number > 1 AND parent_revision_id IS NOT NULL)
  ),
  CHECK (sensitivity IN ('normal', 'sensitive', 'restricted')),
  CHECK (compose_mode IN ('new', 'reply', 'reply_all', 'forward')),
  CHECK (length(trim(subject)) > 0),
  CHECK (hash_version >= 1),
  CHECK (parent_revision_id IS NULL OR parent_revision_id != id),
  CHECK (
    (customer_id IS NULL
      AND customer_association_type IS NULL
      AND customer_associated_by_user_id IS NULL
      AND customer_associated_at IS NULL)
    OR
    (customer_id IS NOT NULL
      -- Explicit IS NOT NULL: NULL IN (...) evaluates unknown and CHECK passes in SQLite.
      AND customer_association_type IS NOT NULL
      AND customer_association_type IN ('auto_match', 'manual')
      AND customer_associated_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_mail_outbound_revisions_chain_number
  ON mail_outbound_revisions (revision_chain_id, revision_number);

CREATE UNIQUE INDEX uq_mail_outbound_revisions_signature_snapshot
  ON mail_outbound_revisions (signature_snapshot_id);

CREATE INDEX idx_mail_outbound_revisions_source_draft
  ON mail_outbound_revisions (source_draft_id);

CREATE INDEX idx_mail_outbound_revisions_created_by
  ON mail_outbound_revisions (created_by_user_id);

CREATE INDEX idx_mail_outbound_revisions_customer_id
  ON mail_outbound_revisions (customer_id);

-- ---------------------------------------------------------------------------
-- mail_outbound_revision_recipients — immutable recipient snapshot per revision
--
-- Materialized from revision at creation — do NOT read live draft recipients
-- at approval/send time after revision exists.
-- Submission minimum: >=1 unique recipient across To+Cc+Bcc (NOT To-specific) — service layer.
-- Max 50 unique recipients: service layer only.
-- Future: revision recipients -> mail_message_recipients exactly.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_outbound_revision_recipients (
  id TEXT PRIMARY KEY NOT NULL,
  revision_id TEXT NOT NULL,
  recipient_type TEXT NOT NULL,
  address TEXT NOT NULL,
  display_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (revision_id) REFERENCES mail_outbound_revisions (id),
  CHECK (recipient_type IN ('to', 'cc', 'bcc'))
);

CREATE INDEX idx_mail_outbound_revision_recipients_revision_id
  ON mail_outbound_revision_recipients (revision_id);

CREATE UNIQUE INDEX uq_mail_outbound_revision_recipients_revision_address
  ON mail_outbound_revision_recipients (revision_id, lower(address));
