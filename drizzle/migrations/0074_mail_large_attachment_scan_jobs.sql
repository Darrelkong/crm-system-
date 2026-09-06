-- Phase 2C1.7: durable private malware scan processing state.
--
-- CREATE-only migration. It does not rebuild tables, mutate existing Mail rows,
-- backfill security status, create queues, or create provider credentials.
--
-- mail_stored_files.security_scan_status remains the canonical file/send status.
-- job_status below describes only asynchronous provider processing.

CREATE TABLE mail_large_attachment_scan_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  lifecycle_id TEXT NOT NULL,
  stored_file_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_job_id TEXT,
  job_status TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  storage_etag TEXT NOT NULL,
  storage_version TEXT,
  declared_content_hash TEXT NOT NULL,
  provider_content_hash TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  submitted_at TEXT,
  completed_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (lifecycle_id)
    REFERENCES mail_large_attachment_lifecycle (id)
    ON DELETE CASCADE,
  FOREIGN KEY (stored_file_id)
    REFERENCES mail_stored_files (id)
    ON DELETE CASCADE,
  CHECK (
    job_status IN (
      'queued',
      'submitted',
      'polling',
      'retry_wait',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  CHECK (attempt_count >= 0),
  CHECK (
    length(declared_content_hash) = 64
    AND declared_content_hash = lower(declared_content_hash)
    AND declared_content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (
    provider_content_hash IS NULL
    OR (
      length(provider_content_hash) = 64
      AND provider_content_hash = lower(provider_content_hash)
      AND provider_content_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK (length(trim(storage_key)) > 0),
  CHECK (length(trim(storage_etag)) > 0)
);

CREATE UNIQUE INDEX uq_mail_large_attachment_scan_jobs_lifecycle_id
  ON mail_large_attachment_scan_jobs (lifecycle_id);

CREATE UNIQUE INDEX uq_mail_large_attachment_scan_jobs_provider_job
  ON mail_large_attachment_scan_jobs (provider, provider_job_id);

CREATE INDEX idx_mail_large_attachment_scan_jobs_stored_file_id
  ON mail_large_attachment_scan_jobs (stored_file_id);

CREATE INDEX idx_mail_large_attachment_scan_jobs_status_next_attempt
  ON mail_large_attachment_scan_jobs (job_status, next_attempt_at);

CREATE INDEX idx_mail_large_attachment_scan_jobs_provider_job_id
  ON mail_large_attachment_scan_jobs (provider_job_id);
