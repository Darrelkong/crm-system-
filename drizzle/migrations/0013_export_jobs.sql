-- Migration: export_jobs for customer CSV export tracking
CREATE TABLE export_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  exported_by TEXT NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL,
  include_sensitive INTEGER NOT NULL DEFAULT 1,
  fields TEXT NOT NULL,
  exported_count INTEGER NOT NULL DEFAULT 0,
  file_name TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_export_jobs_exported_by ON export_jobs(exported_by);
CREATE INDEX idx_export_jobs_status ON export_jobs(status);
CREATE INDEX idx_export_jobs_created_at ON export_jobs(created_at);
