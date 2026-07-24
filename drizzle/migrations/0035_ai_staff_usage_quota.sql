-- Staff AI deep-analysis usage quota (Phase 4A)
-- Local migration only — do not apply with --remote in this phase.
-- customer_id is intentionally NOT a foreign key so customer purge is not blocked.
-- user_id references users(id); staff accounts are soft-deleted, so historical usage rows remain.

CREATE TABLE IF NOT EXISTS ai_staff_daily_quota (
  user_id TEXT NOT NULL REFERENCES users(id),
  usage_date TEXT NOT NULL,
  reserved_count INTEGER NOT NULL DEFAULT 0,
  succeeded_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, usage_date)
);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  usage_date TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL,
  reservation_key TEXT NOT NULL,
  customer_id TEXT,
  provider TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_usage_events_reservation_key
  ON ai_usage_events(reservation_key);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user_date_status
  ON ai_usage_events(user_id, usage_date, status);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created_at
  ON ai_usage_events(created_at);

CREATE INDEX IF NOT EXISTS idx_ai_staff_daily_quota_usage_date
  ON ai_staff_daily_quota(usage_date);
