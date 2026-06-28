-- Phase D-1b-1: on_hold approval foundation (wrangler-safe)
-- 1. customers: add is_pinned, pinned_at (ALTER only — no customers table rebuild)
-- 2. approvals: rebuild request_type CHECK to add create_on_hold_customer
-- Does NOT extend customers.status CHECK; pending_on_hold is not used.

ALTER TABLE customers ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;

ALTER TABLE customers ADD COLUMN pinned_at TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_is_pinned_pinned_at ON customers (is_pinned, pinned_at);

CREATE TABLE approvals_new (
  id TEXT PRIMARY KEY NOT NULL,
  request_type TEXT NOT NULL CHECK (
    request_type IN (
      'delete_customer',
      'transfer_customer',
      'merge_customers',
      'closed_won',
      'second_conversion',
      'create_on_hold_customer'
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
