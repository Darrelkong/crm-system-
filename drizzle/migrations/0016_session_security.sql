-- Phase 17A: session idle tracking and revocation
ALTER TABLE sessions ADD COLUMN last_activity_at TEXT;
ALTER TABLE sessions ADD COLUMN revoked_at TEXT;

UPDATE sessions SET last_activity_at = created_at WHERE last_activity_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_revoked_at ON sessions (revoked_at);
