-- Smart Ingest 2E-5/6: per-segment candidate comparison + draft conversion linkage.

ALTER TABLE knowledge_ai_comparison_runs
  ADD COLUMN candidate_id TEXT REFERENCES knowledge_source_segment_candidates (id) ON DELETE RESTRICT;

ALTER TABLE knowledge_source_segment_candidates
  ADD COLUMN draft_article_id TEXT REFERENCES knowledge_articles (id) ON DELETE RESTRICT;

ALTER TABLE knowledge_source_segment_candidates
  ADD COLUMN converted_at TEXT;

DROP INDEX IF EXISTS uq_knowledge_ai_comparison_runs_active_source;

CREATE UNIQUE INDEX uq_knowledge_ai_comparison_runs_active_source_legacy
  ON knowledge_ai_comparison_runs (source_id)
  WHERE status IN ('pending', 'processing') AND candidate_id IS NULL;

CREATE UNIQUE INDEX uq_knowledge_ai_comparison_runs_active_candidate
  ON knowledge_ai_comparison_runs (candidate_id)
  WHERE status IN ('pending', 'processing') AND candidate_id IS NOT NULL;

CREATE INDEX idx_knowledge_ai_comparison_runs_candidate_created
  ON knowledge_ai_comparison_runs (candidate_id, created_at);

CREATE INDEX idx_knowledge_source_segment_candidates_draft_article
  ON knowledge_source_segment_candidates (draft_article_id);
