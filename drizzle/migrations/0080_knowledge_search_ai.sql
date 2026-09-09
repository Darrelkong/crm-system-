-- Knowledge Phase 1 Package 5: bounded AI usage metadata.
--
-- Questions, answers, prompts, and retrieved article content are intentionally
-- not persisted. This table only supports concurrency, rolling usage limits,
-- safe audit correlation, and provider failure classification.

CREATE TABLE knowledge_ai_query_runs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  query_hash TEXT NOT NULL,
  query_length INTEGER NOT NULL,
  retrieved_source_count INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  model TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CHECK (query_length >= 1 AND query_length <= 200),
  CHECK (retrieved_source_count >= 0 AND retrieved_source_count <= 8)
);

CREATE INDEX idx_knowledge_ai_query_runs_user_created
  ON knowledge_ai_query_runs (user_id, created_at);

CREATE INDEX idx_knowledge_ai_query_runs_status_created
  ON knowledge_ai_query_runs (status, created_at);

CREATE UNIQUE INDEX uq_knowledge_ai_query_runs_active_user
  ON knowledge_ai_query_runs (user_id)
  WHERE status IN ('pending', 'processing');
