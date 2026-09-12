-- Knowledge P2C-A2: source-to-published comparison runs.
--
-- Additive migration. Comparison is a separate stage from AI organization.

CREATE TABLE knowledge_ai_comparison_runs (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL,
  organization_run_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  relationship TEXT,
  matched_article_id TEXT,
  matched_article_version_id TEXT,
  matched_version_number INTEGER,
  match_confidence REAL,
  candidate_snapshot_json TEXT NOT NULL,
  comparison_json TEXT,
  degradation_level TEXT,
  provider TEXT,
  model TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (source_id) REFERENCES knowledge_sources (id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_run_id) REFERENCES knowledge_ai_organization_runs (id) ON DELETE RESTRICT,
  FOREIGN KEY (requested_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  FOREIGN KEY (matched_article_id) REFERENCES knowledge_articles (id) ON DELETE SET NULL,
  FOREIGN KEY (matched_article_version_id) REFERENCES knowledge_article_versions (id) ON DELETE SET NULL,
  CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CHECK (
    relationship IS NULL
    OR relationship IN ('update_existing', 'new_article', 'ambiguous', 'no_match')
  ),
  CHECK (
    match_confidence IS NULL
    OR (match_confidence >= 0 AND match_confidence <= 1)
  ),
  CHECK (provider IS NULL OR length(provider) <= 80),
  CHECK (model IS NULL OR length(model) <= 160)
);

CREATE INDEX idx_knowledge_ai_comparison_runs_source_created
  ON knowledge_ai_comparison_runs (source_id, created_at);

CREATE INDEX idx_knowledge_ai_comparison_runs_organization_run
  ON knowledge_ai_comparison_runs (organization_run_id);

CREATE UNIQUE INDEX uq_knowledge_ai_comparison_runs_active_source
  ON knowledge_ai_comparison_runs (source_id)
  WHERE status IN ('pending', 'processing');
