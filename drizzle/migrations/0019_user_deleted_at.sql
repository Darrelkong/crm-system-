-- Phase 18E: soft delete for staff accounts

ALTER TABLE users ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);
