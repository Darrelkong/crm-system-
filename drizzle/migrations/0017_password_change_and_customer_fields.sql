-- Phase 17B: forced password change flags + customer requested project name
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE users ADD COLUMN password_reset_at TEXT;

ALTER TABLE customers ADD COLUMN requested_project_name TEXT;
