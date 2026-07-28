-- Expand quick-entry submission row duplicate_field CHECK to allow email.
-- SQLite cannot ALTER CHECK; rebuild table with equivalent schema otherwise.

CREATE TABLE public_pool_quick_entry_submission_rows_new (
  id TEXT PRIMARY KEY NOT NULL,
  submission_db_id TEXT NOT NULL REFERENCES public_pool_quick_entry_submissions (id) ON DELETE CASCADE,
  client_row_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('invalid', 'duplicate', 'created', 'failed')
  ),
  error_code TEXT,
  duplicate_field TEXT CHECK (
    duplicate_field IS NULL OR duplicate_field IN ('phone', 'wechatId', 'email')
  ),
  customer_id TEXT,
  customer_code TEXT,
  customer_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO public_pool_quick_entry_submission_rows_new (
  id,
  submission_db_id,
  client_row_id,
  row_index,
  status,
  error_code,
  duplicate_field,
  customer_id,
  customer_code,
  customer_name,
  created_at,
  updated_at
)
SELECT
  id,
  submission_db_id,
  client_row_id,
  row_index,
  status,
  error_code,
  duplicate_field,
  customer_id,
  customer_code,
  customer_name,
  created_at,
  updated_at
FROM public_pool_quick_entry_submission_rows;

DROP TABLE public_pool_quick_entry_submission_rows;
ALTER TABLE public_pool_quick_entry_submission_rows_new
  RENAME TO public_pool_quick_entry_submission_rows;

CREATE UNIQUE INDEX idx_ppqe_submission_rows_client_row
  ON public_pool_quick_entry_submission_rows (submission_db_id, client_row_id);

CREATE UNIQUE INDEX idx_ppqe_submission_rows_row_index
  ON public_pool_quick_entry_submission_rows (submission_db_id, row_index);
