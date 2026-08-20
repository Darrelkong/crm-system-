-- Phase 2B.19 / 0060_mail_receiving_address.sql: Inbound receiving address routing registry
-- ADDITIVE ONLY. Depends on 0052_mail_foundation.sql (mail_mailboxes).
--
-- Purpose: canonical inbound routing layer — normalized SMTP envelope recipient
--   address → exactly one Mailbox. Does NOT decide outbound From identity.
--
-- Domain boundary (LOCKED):
--   Mailbox != Sender Identity. Receiving Address != Sender Identity.
--   The same normalized address MAY exist in mail_receiving_addresses AND
--   mail_sender_identities (e.g. daniel@ receives into Daniel Mailbox AND sends
--   as an authorized From identity). Do NOT create cross-table uniqueness here.
--
--   Inbound routing MUST NOT inspect mail_sender_identities.alias_of_identity_id.
--
-- Primary source of truth:
--   mail_mailboxes.address remains the Mailbox primary address identity.
--   address_type = primary rows are the inbound routing representation of that
--   address. Future service invariant (no triggers): CURRENT primary receiving row
--   address MUST match mail_mailboxes.address under product normalization semantics:
--   trim, Unicode NFC, lowercase.
--
-- Current Primary vs Historical Primary (2B.19.2):
--   CURRENT PRIMARY: address_type = primary AND status IN (active, suspended)
--   HISTORICAL PRIMARY: address_type = primary AND status = retired
--   At most ONE current Primary per Mailbox (partial UNIQUE below).
--   Zero or more retired historical Primary rows may coexist — old addresses remain
--   globally reserved via uq_mail_receiving_addresses_address.
--
-- Primary address mutation (future mailbox address-management service — NOT here):
--   Do NOT simply overwrite an existing Primary Receiving Address row.
--   Preferred atomic lifecycle (exact D1 batch/guarded mutation designed before service):
--     A. Retire old current Primary (status → retired, retired_at set).
--     B. Preserve old row permanently as historical Primary (immutable).
--     C. Create new current Primary Receiving Address row.
--     D. Update mail_mailboxes.address to the new canonical primary value.
--   Unsafe independent statements must not temporarily leave: two current Primaries,
--   no current Primary, or mail_mailboxes.address mismatched from current Primary.
--   No triggers in 0060.
--
-- Address normalization (service layer — NOT provider-specific):
--   trim whitespace, Unicode NFC, lowercase entire address before lookup.
--   No Gmail dot removal, plus stripping, or alias guessing.
--   Stored address MUST equal TRIM(address) — enforced by CHECK.
--   lower(trim(address)) UNIQUE index is defense-in-depth.
--
-- Envelope provenance, provider ingestion/quarantine, and inbound materialization
--   provenance are intentionally deferred to the next inbound ingestion domain.
--
-- Rollback policy: do NOT drop this table as a normal rollback.
-- Retired receiving addresses remain lifetime-reserved — never hard-deleted for reuse.

-- ---------------------------------------------------------------------------
-- mail_receiving_addresses — one row = one lifetime-reserved inbound routable address
--
-- mailbox_id: required FK; exactly one mailbox target per row.
-- Lifetime case-insensitive address uniqueness prevents one address → two mailboxes.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_receiving_addresses (
  id TEXT PRIMARY KEY NOT NULL,
  mailbox_id TEXT NOT NULL,
  address TEXT NOT NULL,
  address_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  retired_at TEXT,
  FOREIGN KEY (mailbox_id) REFERENCES mail_mailboxes (id),
  FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (address_type IN ('primary', 'alias')),
  CHECK (status IN ('active', 'suspended', 'retired')),
  CHECK (LENGTH(TRIM(address)) > 0),
  CHECK (address = TRIM(address)),
  CHECK (
    (status = 'retired' AND retired_at IS NOT NULL)
    OR (status != 'retired' AND retired_at IS NULL)
  )
);

-- Lifetime case-insensitive trimmed uniqueness — active, suspended, AND retired rows included.
-- A retired address cannot be reused by another Mailbox.
CREATE UNIQUE INDEX uq_mail_receiving_addresses_address
  ON mail_receiving_addresses (lower(trim(address)));

-- At most one CURRENT primary receiving route per Mailbox (active or suspended).
-- Retired historical Primary rows are excluded — multiple may coexist per mailbox.
-- Multiple aliases allowed; current-primary rule does not apply to aliases.
CREATE UNIQUE INDEX uq_mail_receiving_addresses_primary_per_mailbox
  ON mail_receiving_addresses (mailbox_id)
  WHERE address_type = 'primary'
    AND status IN ('active', 'suspended');

CREATE INDEX idx_mail_receiving_addresses_mailbox_id
  ON mail_receiving_addresses (mailbox_id);

CREATE INDEX idx_mail_receiving_addresses_status
  ON mail_receiving_addresses (status);

-- ---------------------------------------------------------------------------
-- Backfill: one primary receiving route per existing Mailbox (fail-closed)
--
-- Deterministic IDs: mra_primary_<mailbox_id> (migration-safe; no random UUID in SQL).
-- Addresses copied from TRIM(mail_mailboxes.address) — no invented addresses.
-- INSERT INTO (NOT OR IGNORE / OR REPLACE): every Mailbox MUST receive exactly one
--   primary row; constraint conflicts or blank addresses after TRIM abort the migration.
-- Blank or whitespace-only mailbox addresses fail LENGTH(TRIM(address)) > 0 CHECK.
--
-- Initial route status mapping (route ownership preserved; effective inbound handling
--   for archived/deleted mailboxes is future service policy — NOT reassignment here):
--   mailbox active     → receiving active
--   mailbox suspended  → receiving suspended
--   mailbox archived   → receiving suspended (original mailbox owns route)
--   mailbox deleted    → receiving retired (address remains reserved; retired_at set)
-- Deleted mailbox may therefore have one retired historical Primary and no current Primary.
-- ---------------------------------------------------------------------------
INSERT INTO mail_receiving_addresses (
  id,
  mailbox_id,
  address,
  address_type,
  status,
  created_by_user_id,
  created_at,
  updated_at,
  retired_at
)
SELECT
  'mra_primary_' || m.id,
  m.id,
  TRIM(m.address),
  'primary',
  CASE m.status
    WHEN 'active' THEN 'active'
    WHEN 'suspended' THEN 'suspended'
    WHEN 'archived' THEN 'suspended'
    WHEN 'deleted' THEN 'retired'
  END,
  m.created_by,
  m.created_at,
  m.updated_at,
  CASE
    WHEN m.status = 'deleted' THEN COALESCE(m.deleted_at, m.updated_at, datetime('now'))
    ELSE NULL
  END
FROM mail_mailboxes m;
