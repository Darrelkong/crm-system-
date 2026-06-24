-- Migration: expand notification types for approvals (Phase 8)

CREATE TABLE notifications_new (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_entity_type TEXT,
  related_entity_id TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

INSERT INTO notifications_new (
  id,
  user_id,
  type,
  title,
  message,
  related_entity_type,
  related_entity_id,
  is_read,
  created_at
)
SELECT
  id,
  user_id,
  type,
  title,
  message,
  related_entity_type,
  related_entity_id,
  is_read,
  created_at
FROM notifications;

DROP TABLE notifications;

ALTER TABLE notifications_new RENAME TO notifications;

CREATE INDEX idx_notifications_user_id ON notifications (user_id);
CREATE INDEX idx_notifications_created_at ON notifications (created_at);
CREATE INDEX idx_notifications_related ON notifications (related_entity_type, related_entity_id);
