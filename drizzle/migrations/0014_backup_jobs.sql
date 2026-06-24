-- Migration: backup_jobs for database backup tracking (Phase 10C)
CREATE TABLE backup_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  backup_type TEXT NOT NULL,
  triggered_by TEXT REFERENCES users(id),
  file_name TEXT,
  storage_provider TEXT,
  storage_key TEXT,
  table_count INTEGER NOT NULL DEFAULT 0,
  record_count INTEGER NOT NULL DEFAULT 0,
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_backup_jobs_status ON backup_jobs(status);
CREATE INDEX idx_backup_jobs_backup_type ON backup_jobs(backup_type);
CREATE INDEX idx_backup_jobs_created_at ON backup_jobs(created_at);
CREATE INDEX idx_backup_jobs_triggered_by ON backup_jobs(triggered_by);
