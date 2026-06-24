-- Migration: field_change_logs for customer edit history (Phase 4)
CREATE TABLE field_change_logs (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT NOT NULL REFERENCES users (id),
  changed_at TEXT NOT NULL
);

CREATE INDEX idx_field_change_logs_customer_id ON field_change_logs (customer_id);
CREATE INDEX idx_field_change_logs_changed_at ON field_change_logs (changed_at);
