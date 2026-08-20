-- Phase 2B.1: Mail foundation (access, admin grants, notification identities, mailboxes, sender identities)
-- ADDITIVE ONLY. No seed data. No message/approval/transport tables in this migration.
--
-- Rollback policy: do NOT drop these tables as a normal rollback.
-- Mail historical records must not be destroyed by accidental CASCADE.

-- ---------------------------------------------------------------------------
-- mail_user_access — CRM account != Mail access
-- ---------------------------------------------------------------------------
CREATE TABLE mail_user_access (
  user_id TEXT PRIMARY KEY NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 0,
  enabled_at TEXT,
  enabled_by TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id),
  FOREIGN KEY (enabled_by) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (is_enabled IN (0, 1))
);

CREATE INDEX idx_mail_user_access_enabled
  ON mail_user_access (is_enabled);

-- ---------------------------------------------------------------------------
-- mail_admin_grants — Mail Admin permissions (separate from users.role)
-- ---------------------------------------------------------------------------
CREATE TABLE mail_admin_grants (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  granted_by TEXT,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  revoke_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id),
  FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (revoked_by) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (
    permission IN (
      'super_admin',
      'global_mail_read',
      'account_mgmt',
      'address_assignment',
      'signature_template',
      'auto_reply',
      'audit_view',
      'domain_health',
      'delivery_health',
      'permission_mgmt'
    )
  )
);

CREATE INDEX idx_mail_admin_grants_user_id
  ON mail_admin_grants (user_id);

CREATE INDEX idx_mail_admin_grants_permission
  ON mail_admin_grants (permission);

-- One active grant per user + permission.
CREATE UNIQUE INDEX uq_mail_admin_grants_user_permission_active
  ON mail_admin_grants (user_id, permission)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- mail_notification_identities — verification vs delivery health are separate
--
-- Email replacement workflow (service layer):
--   - Old verified identity stays active while new@ is pending verification.
--   - Partial uniques allow one active verified AND one active pending per user.
--
-- Atomic switch on verify (single transaction; order is mandatory):
--   1. Validate new pending verification token (outside or inside txn).
--   2. In ONE atomic batch:
--      a. REVOKE the currently verified identity (status -> revoked, revoked_at set).
--      b. PROMOTE the new pending identity to verified (status -> verified, verified_at set).
--   3. Commit.
-- Promoting new before revoking old would violate uq_..._user_verified_active.
-- External readers must never observe zero verified or two verified identities.
--
-- Case-insensitive email uniqueness (defense-in-depth; service still lowercases):
--   active pending/verified rows are unique on lower(email).
-- ---------------------------------------------------------------------------
CREATE TABLE mail_notification_identities (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  verification_token_hash TEXT,
  verification_requested_at TEXT,
  verification_expires_at TEXT,
  verified_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  revoke_reason TEXT,
  delivery_health TEXT NOT NULL DEFAULT 'unknown',
  delivery_problem_at TEXT,
  last_delivery_status TEXT,
  last_delivery_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id),
  FOREIGN KEY (revoked_by) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (verification_status IN ('pending', 'verified', 'revoked')),
  CHECK (delivery_health IN ('unknown', 'healthy', 'temporary_problem', 'bounced')),
  CHECK (
    (verification_status = 'verified' AND verified_at IS NOT NULL)
    OR (verification_status != 'verified')
  ),
  CHECK (
    (verification_status = 'revoked' AND revoked_at IS NOT NULL)
    OR (verification_status != 'revoked')
  )
);

CREATE INDEX idx_mail_notification_identities_user_id
  ON mail_notification_identities (user_id);

CREATE INDEX idx_mail_notification_identities_email
  ON mail_notification_identities (email);

CREATE INDEX idx_mail_notification_identities_verification
  ON mail_notification_identities (user_id, verification_status);

CREATE INDEX idx_mail_notification_identities_delivery_health
  ON mail_notification_identities (delivery_health);

-- At most one active verified notification identity per user.
CREATE UNIQUE INDEX uq_mail_notification_identities_user_verified_active
  ON mail_notification_identities (user_id)
  WHERE verification_status = 'verified' AND revoked_at IS NULL;

-- At most one active pending notification identity per user (email change in flight).
CREATE UNIQUE INDEX uq_mail_notification_identities_user_pending_active
  ON mail_notification_identities (user_id)
  WHERE verification_status = 'pending' AND revoked_at IS NULL;

-- Email cannot be claimed by two active pending/verified identities (case-insensitive).
CREATE UNIQUE INDEX uq_mail_notification_identities_email_active
  ON mail_notification_identities (lower(email))
  WHERE verification_status IN ('pending', 'verified') AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- mail_mailboxes — company-owned receiving workspace
-- ---------------------------------------------------------------------------
CREATE TABLE mail_mailboxes (
  id TEXT PRIMARY KEY NOT NULL,
  address TEXT NOT NULL,
  display_name TEXT,
  mailbox_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  deleted_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (mailbox_type IN ('personal', 'shared')),
  CHECK (status IN ('active', 'suspended', 'archived', 'deleted')),
  CHECK (
    (status = 'deleted' AND deleted_at IS NOT NULL)
    OR (status != 'deleted')
  )
);

CREATE INDEX idx_mail_mailboxes_status
  ON mail_mailboxes (status);

CREATE INDEX idx_mail_mailboxes_type
  ON mail_mailboxes (mailbox_type);

-- Address unique for the lifetime of the table (case-insensitive).
-- Soft delete does NOT release the address; restore/reactivate the existing row.
CREATE UNIQUE INDEX uq_mail_mailboxes_address
  ON mail_mailboxes (lower(address));

-- ---------------------------------------------------------------------------
-- mail_sender_identities — mailbox != sender identity
--
-- Routing invariant (service layer + CHECK):
--   default_mailbox_id IS NOT NULL OR sent_folder_mailbox_id IS NOT NULL
-- When default_mailbox_id IS NULL, sent_folder_mailbox_id is required and the
-- actor must still hold mailbox membership on sent_folder_mailbox_id.
-- Sender identity grant alone does NOT bypass mailbox membership.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_sender_identities (
  id TEXT PRIMARY KEY NOT NULL,
  address TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  default_mailbox_id TEXT,
  sent_folder_mailbox_id TEXT,
  alias_of_identity_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (default_mailbox_id) REFERENCES mail_mailboxes (id),
  FOREIGN KEY (sent_folder_mailbox_id) REFERENCES mail_mailboxes (id),
  FOREIGN KEY (alias_of_identity_id) REFERENCES mail_sender_identities (id),
  FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (status IN ('active', 'suspended', 'deleted')),
  CHECK (
    default_mailbox_id IS NOT NULL
    OR sent_folder_mailbox_id IS NOT NULL
  )
);

CREATE INDEX idx_mail_sender_identities_status
  ON mail_sender_identities (status);

CREATE INDEX idx_mail_sender_identities_default_mailbox
  ON mail_sender_identities (default_mailbox_id);

CREATE INDEX idx_mail_sender_identities_sent_folder_mailbox
  ON mail_sender_identities (sent_folder_mailbox_id);

CREATE INDEX idx_mail_sender_identities_alias
  ON mail_sender_identities (alias_of_identity_id);

-- Address unique for the lifetime of the table (case-insensitive).
-- Deleted identities do NOT release the address; restore/reactivate the existing row.
CREATE UNIQUE INDEX uq_mail_sender_identities_address
  ON mail_sender_identities (lower(address));

-- ---------------------------------------------------------------------------
-- mail_mailbox_members — mailbox workspace permissions
--
-- Future send/reply authorization (service layer):
--   REPLY requires mailbox can_reply AND sender identity grant can_reply (AND, never OR).
--   SEND requires mailbox can_send AND sender identity grant can_send (AND, never OR).
-- ---------------------------------------------------------------------------
CREATE TABLE mail_mailbox_members (
  id TEXT PRIMARY KEY NOT NULL,
  mailbox_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  can_read INTEGER NOT NULL DEFAULT 0,
  can_reply INTEGER NOT NULL DEFAULT 0,
  can_send INTEGER NOT NULL DEFAULT 0,
  can_assign INTEGER NOT NULL DEFAULT 0,
  can_manage_processing INTEGER NOT NULL DEFAULT 0,
  can_add_internal_note INTEGER NOT NULL DEFAULT 0,
  granted_by TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (mailbox_id) REFERENCES mail_mailboxes (id),
  FOREIGN KEY (user_id) REFERENCES users (id),
  FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (revoked_by) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (can_read IN (0, 1)),
  CHECK (can_reply IN (0, 1)),
  CHECK (can_send IN (0, 1)),
  CHECK (can_assign IN (0, 1)),
  CHECK (can_manage_processing IN (0, 1)),
  CHECK (can_add_internal_note IN (0, 1))
);

CREATE INDEX idx_mail_mailbox_members_user_id
  ON mail_mailbox_members (user_id);

CREATE INDEX idx_mail_mailbox_members_mailbox_id
  ON mail_mailbox_members (mailbox_id);

-- One active membership per mailbox + user.
CREATE UNIQUE INDEX uq_mail_mailbox_members_mailbox_user_active
  ON mail_mailbox_members (mailbox_id, user_id)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- mail_sender_identity_grants — authorized From identities (separate from mailbox membership)
-- ---------------------------------------------------------------------------
CREATE TABLE mail_sender_identity_grants (
  id TEXT PRIMARY KEY NOT NULL,
  sender_identity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  can_reply INTEGER NOT NULL DEFAULT 0,
  can_send INTEGER NOT NULL DEFAULT 0,
  granted_by TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sender_identity_id) REFERENCES mail_sender_identities (id),
  FOREIGN KEY (user_id) REFERENCES users (id),
  FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (revoked_by) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (can_reply IN (0, 1)),
  CHECK (can_send IN (0, 1))
);

CREATE INDEX idx_mail_sender_identity_grants_user_id
  ON mail_sender_identity_grants (user_id);

CREATE INDEX idx_mail_sender_identity_grants_identity_id
  ON mail_sender_identity_grants (sender_identity_id);

-- One active grant per sender identity + user.
CREATE UNIQUE INDEX uq_mail_sender_identity_grants_identity_user_active
  ON mail_sender_identity_grants (sender_identity_id, user_id)
  WHERE revoked_at IS NULL;
