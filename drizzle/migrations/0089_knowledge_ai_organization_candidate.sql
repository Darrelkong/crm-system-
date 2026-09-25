-- Smart Ingest 2E-3/4: candidate-scoped AI organization runs (nullable candidate_id).

ALTER TABLE knowledge_ai_organization_runs
  ADD COLUMN candidate_id TEXT REFERENCES knowledge_source_segment_candidates (id) ON DELETE RESTRICT;

CREATE INDEX idx_knowledge_ai_runs_candidate_created
  ON knowledge_ai_organization_runs (candidate_id, created_at);

DROP INDEX uq_knowledge_ai_runs_active_source;

CREATE UNIQUE INDEX uq_knowledge_ai_runs_active_source_legacy
  ON knowledge_ai_organization_runs (source_id)
  WHERE candidate_id IS NULL AND status IN ('pending', 'processing');

CREATE UNIQUE INDEX uq_knowledge_ai_runs_active_candidate
  ON knowledge_ai_organization_runs (candidate_id)
  WHERE candidate_id IS NOT NULL AND status IN ('pending', 'processing');
