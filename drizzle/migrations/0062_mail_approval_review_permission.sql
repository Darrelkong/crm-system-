-- Phase 2C.6.2: Add approval_review Mail Admin permission
-- ADDITIVE ONLY. Depends on 0052–0061.
--
-- Semantic change: extend mail_admin_grants.permission CHECK to include
-- 'approval_review'. No columns added/removed. No other Mail tables altered.
--
-- SQLite cannot ALTER CHECK in place — safe table rebuild preserving all rows.
-- No inbound FK references mail_admin_grants (outbound FKs to users only).

CREATE TABLE mail_admin_grants_new (
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
      'permission_mgmt',
      'approval_review'
    )
  )
);

INSERT INTO mail_admin_grants_new (
  id,
  user_id,
  permission,
  granted_by,
  granted_at,
  revoked_at,
  revoked_by,
  revoke_reason,
  created_at,
  updated_at
)
SELECT
  id,
  user_id,
  permission,
  granted_by,
  granted_at,
  revoked_at,
  revoked_by,
  revoke_reason,
  created_at,
  updated_at
FROM mail_admin_grants;

DROP TABLE mail_admin_grants;

ALTER TABLE mail_admin_grants_new RENAME TO mail_admin_grants;

CREATE INDEX idx_mail_admin_grants_user_id
  ON mail_admin_grants (user_id);

CREATE INDEX idx_mail_admin_grants_permission
  ON mail_admin_grants (permission);

CREATE UNIQUE INDEX uq_mail_admin_grants_user_permission_active
  ON mail_admin_grants (user_id, permission)
  WHERE revoked_at IS NULL;
