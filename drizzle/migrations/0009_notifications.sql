-- Migration: notifications + reclamation warning dedup (Phase 7)

CREATE TABLE notifications (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  type TEXT NOT NULL CHECK (
    type IN (
      'auto_reclaim_warning_day_6',
      'auto_reclaim_warning_day_7',
      'customer_auto_reclaimed'
    )
  ),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_entity_type TEXT,
  related_entity_id TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_notifications_user_id ON notifications (user_id);
CREATE INDEX idx_notifications_created_at ON notifications (created_at);
CREATE INDEX idx_notifications_related ON notifications (related_entity_type, related_entity_id);

CREATE TABLE reclamation_warning_logs (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers (id),
  warning_type TEXT NOT NULL CHECK (warning_type IN ('day_6', 'day_7')),
  warning_date TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_reclamation_warning_unique ON reclamation_warning_logs (
  customer_id,
  warning_type,
  warning_date
);

CREATE INDEX idx_reclamation_warning_customer ON reclamation_warning_logs (customer_id);
