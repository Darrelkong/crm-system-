-- QUICK-ENTRY-1: session-bound grant / lockout for public pool quick entry
ALTER TABLE sessions ADD COLUMN quick_entry_grant_until TEXT;
ALTER TABLE sessions ADD COLUMN quick_entry_grant_version INTEGER;
ALTER TABLE sessions ADD COLUMN quick_entry_failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN quick_entry_locked_until TEXT;
