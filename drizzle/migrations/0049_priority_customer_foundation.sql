-- TASK 15-PRE: priority customer foundation
-- 1. customers: add pinned_source metadata (ALTER only — no customers table rebuild)
-- 2. approvals: add set_priority_customer and unset_priority_customer request types

ALTER TABLE customers ADD COLUMN pinned_source TEXT CHECK (
  pinned_source IS NULL
  OR pinned_source IN (
    'on_hold_auto',
    'admin_direct',
    'approval',
    'legacy'
  )
);

UPDATE customers
SET pinned_source = 'legacy'
WHERE is_pinned = 1
  AND pinned_source IS NULL;

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
      'update_customer_assignees',
      'paid_customer',
      'link_family_customer',
      'update_family_relationship',
      'unlink_family_customer',
      'set_priority_customer',
      'unset_priority_customer'
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
