-- Phase 3: separate notification read state from action lifecycle; reclamation work-item links.

ALTER TABLE notifications ADD COLUMN action_state TEXT NOT NULL DEFAULT 'informational';
ALTER TABLE notifications ADD COLUMN grouping_key TEXT;
ALTER TABLE notifications ADD COLUMN action_updated_at TEXT;
ALTER TABLE notifications ADD COLUMN summary_scope TEXT;

-- Historical approval requests still need action.
UPDATE notifications
SET action_state = 'pending'
WHERE type = 'approval.pending';

-- Legacy per-customer reclaim warnings are superseded by summary items in Work Items.
UPDATE notifications
SET action_state = 'informational'
WHERE type IN ('auto_reclaim_warning_day_6', 'auto_reclaim_warning_day_7');

CREATE TABLE reclamation_action_items (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  customer_id TEXT NOT NULL REFERENCES customers (id),
  cycle_started_at TEXT NOT NULL,
  action_state TEXT NOT NULL CHECK (action_state IN ('pending', 'completed', 'expired')),
  risk_band TEXT NOT NULL CHECK (
    risk_band IN ('tomorrow', 'within_7', 'within_14', 'routine')
  ),
  idle_days INTEGER NOT NULL,
  reclaim_days_snapshot INTEGER NOT NULL,
  completed_at TEXT,
  expired_at TEXT,
  completed_follow_up_id TEXT REFERENCES follow_ups (id),
  expire_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_reclamation_action_items_owner_cycle ON reclamation_action_items (
  customer_id,
  cycle_started_at,
  user_id
);

CREATE INDEX idx_reclamation_action_items_user_state ON reclamation_action_items (user_id, action_state);

CREATE UNIQUE INDEX idx_notifications_user_grouping_pending ON notifications (user_id, grouping_key)
WHERE action_state = 'pending' AND grouping_key IS NOT NULL;
