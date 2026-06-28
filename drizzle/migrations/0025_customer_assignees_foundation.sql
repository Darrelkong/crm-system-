-- Phase D-2a: customer assignees foundation (wrangler-safe)
-- 1. customer_assignees table + backfill from customers.owner_id
-- 2. approvals: rebuild request_type CHECK to add update_customer_assignees

CREATE TABLE customer_assignees (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'collaborator',
  assigned_by TEXT,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id),
  FOREIGN KEY (assigned_by) REFERENCES users (id),
  CHECK (role IN ('primary', 'collaborator'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_assignees_customer_user
  ON customer_assignees (customer_id, user_id);

CREATE INDEX IF NOT EXISTS idx_customer_assignees_user_id
  ON customer_assignees (user_id);

CREATE INDEX IF NOT EXISTS idx_customer_assignees_customer_id
  ON customer_assignees (customer_id);

INSERT OR IGNORE INTO customer_assignees (
  id,
  customer_id,
  user_id,
  role,
  assigned_by,
  assigned_at,
  created_at,
  updated_at
)
SELECT
  'ca_' || c.id || '_' || c.owner_id,
  c.id,
  c.owner_id,
  'primary',
  COALESCE(c.created_by, c.owner_id),
  COALESCE(c.created_at, datetime('now')),
  COALESCE(c.created_at, datetime('now')),
  COALESCE(c.updated_at, datetime('now'))
FROM customers c
WHERE c.owner_id IS NOT NULL;

CREATE TABLE approvals_new (
  id TEXT PRIMARY KEY NOT NULL,
  request_type TEXT NOT NULL CHECK (
    request_type IN (
      'delete_customer',
      'transfer_customer',
      'merge_customers',
      'closed_won',
      'second_conversion',
      'create_on_hold_customer',
      'update_customer_assignees'
    )
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected')
  ),
  customer_id TEXT NOT NULL REFERENCES customers (id),
  requested_by TEXT NOT NULL REFERENCES users (id),
  target_user_id TEXT REFERENCES users (id),
  related_customer_ids TEXT,
  payload TEXT,
  reason TEXT NOT NULL,
  admin_comment TEXT,
  reviewed_by TEXT REFERENCES users (id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO approvals_new (
  id,
  request_type,
  status,
  customer_id,
  requested_by,
  target_user_id,
  related_customer_ids,
  payload,
  reason,
  admin_comment,
  reviewed_by,
  reviewed_at,
  created_at,
  updated_at
)
SELECT
  id,
  request_type,
  status,
  customer_id,
  requested_by,
  target_user_id,
  related_customer_ids,
  payload,
  reason,
  admin_comment,
  reviewed_by,
  reviewed_at,
  created_at,
  updated_at
FROM approvals;

DROP TABLE approvals;

ALTER TABLE approvals_new RENAME TO approvals;

CREATE INDEX idx_approvals_status ON approvals (status);

CREATE INDEX idx_approvals_customer_id ON approvals (customer_id);

CREATE INDEX idx_approvals_requested_by ON approvals (requested_by);

CREATE INDEX idx_approvals_pending_lookup ON approvals (
  customer_id,
  request_type,
  status
);
