-- Migration: approvals table (Phase 8)

CREATE TABLE approvals (
  id TEXT PRIMARY KEY NOT NULL,
  request_type TEXT NOT NULL CHECK (
    request_type IN (
      'delete_customer',
      'transfer_customer',
      'merge_customers',
      'closed_won',
      'second_conversion'
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

CREATE INDEX idx_approvals_status ON approvals (status);
CREATE INDEX idx_approvals_customer_id ON approvals (customer_id);
CREATE INDEX idx_approvals_requested_by ON approvals (requested_by);
CREATE INDEX idx_approvals_pending_lookup ON approvals (
  customer_id,
  request_type,
  status
);
