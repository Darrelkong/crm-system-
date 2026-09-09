-- Knowledge Phase 1 Package 3: private source ingestion and AI organization.
--
-- This migration is additive. Sources contain internal Knowledge material only;
-- there are intentionally no CRM/customer relationships or public file URLs.

CREATE TABLE knowledge_sources (
  id TEXT PRIMARY KEY NOT NULL,
  source_type TEXT NOT NULL,
  source_title TEXT,
  original_filename TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  raw_text TEXT,
  storage_key TEXT,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  processed_at TEXT,
  failure_code TEXT,
  linked_article_id TEXT,
  FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  FOREIGN KEY (linked_article_id) REFERENCES knowledge_articles (id) ON DELETE SET NULL,
  CHECK (source_type IN ('paste', 'file')),
  CHECK (status IN ('received', 'extracting', 'ready', 'organizing', 'organized', 'failed', 'converted')),
  CHECK (length(trim(content_hash)) > 0),
  CHECK (size_bytes IS NULL OR size_bytes >= 0),
  CHECK (source_type <> 'file' OR storage_key IS NOT NULL)
);

CREATE INDEX idx_knowledge_sources_creator_updated
  ON knowledge_sources (created_by_user_id, updated_at);

CREATE INDEX idx_knowledge_sources_status_updated
  ON knowledge_sources (status, updated_at);

CREATE INDEX idx_knowledge_sources_content_hash
  ON knowledge_sources (content_hash);

CREATE TABLE knowledge_ai_organization_runs (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT,
  model TEXT,
  proposed_title TEXT,
  proposed_summary TEXT,
  proposed_body TEXT,
  proposed_category TEXT,
  warnings_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  failure_code TEXT,
  FOREIGN KEY (source_id) REFERENCES knowledge_sources (id) ON DELETE RESTRICT,
  FOREIGN KEY (requested_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CHECK (provider IS NULL OR length(provider) <= 80),
  CHECK (model IS NULL OR length(model) <= 160)
);

CREATE INDEX idx_knowledge_ai_runs_source_created
  ON knowledge_ai_organization_runs (source_id, created_at);

CREATE INDEX idx_knowledge_ai_runs_requester_created
  ON knowledge_ai_organization_runs (requested_by_user_id, created_at);

CREATE UNIQUE INDEX uq_knowledge_ai_runs_active_source
  ON knowledge_ai_organization_runs (source_id)
  WHERE status IN ('pending', 'processing');
