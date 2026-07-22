-- QUICK-ENTRY-3A: submission idempotency foundation for public pool quick entry
-- Additive only: CREATE TABLE / UNIQUE INDEX / INDEX

CREATE TABLE public_pool_quick_entry_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users (id),
  submission_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed')),
  row_count INTEGER NOT NULL,
  created_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  processing_started_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_ppqe_submissions_actor_submission
  ON public_pool_quick_entry_submissions (actor_user_id, submission_id);

CREATE INDEX idx_ppqe_submissions_status
  ON public_pool_quick_entry_submissions (status);

CREATE INDEX idx_ppqe_submissions_expires_at
  ON public_pool_quick_entry_submissions (expires_at);

CREATE TABLE public_pool_quick_entry_submission_rows (
  id TEXT PRIMARY KEY NOT NULL,
  submission_db_id TEXT NOT NULL REFERENCES public_pool_quick_entry_submissions (id) ON DELETE CASCADE,
  client_row_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('invalid', 'duplicate', 'created', 'failed')
  ),
  error_code TEXT,
  duplicate_field TEXT CHECK (
    duplicate_field IS NULL OR duplicate_field IN ('phone', 'wechatId')
  ),
  customer_id TEXT,
  customer_code TEXT,
  customer_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_ppqe_submission_rows_client_row
  ON public_pool_quick_entry_submission_rows (submission_db_id, client_row_id);

CREATE UNIQUE INDEX idx_ppqe_submission_rows_row_index
  ON public_pool_quick_entry_submission_rows (submission_db_id, row_index);
