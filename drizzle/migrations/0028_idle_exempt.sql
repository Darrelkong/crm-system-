-- IDLE-EXEMPT-2A: secondary idle exemption fields on sessions
ALTER TABLE sessions ADD COLUMN idle_exempt_until TEXT;
ALTER TABLE sessions ADD COLUMN idle_exempt_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN idle_exempt_locked_until TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_idle_exempt_until ON sessions (idle_exempt_until);
