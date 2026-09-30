-- Smart Ingest 2E-1: one persisted candidate per confirmed segment (workflow shell).

CREATE TABLE knowledge_source_segment_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES knowledge_sources (id) ON DELETE RESTRICT,
  segment_id TEXT NOT NULL REFERENCES knowledge_source_segments (id) ON DELETE RESTRICT,
  analysis_run_id TEXT NOT NULL REFERENCES knowledge_source_analysis_runs (id) ON DELETE RESTRICT,
  segment_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_project_code TEXT,
  knowledge_category_id TEXT REFERENCES knowledge_categories (id) ON DELETE RESTRICT,
  category_resolution_source TEXT,
  manual_requested_project_override INTEGER NOT NULL DEFAULT 0,
  manual_category_override INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  superseded_at TEXT,
  superseded_by_analysis_run_id TEXT REFERENCES knowledge_source_analysis_runs (id) ON DELETE RESTRICT,
  CHECK (status IN ('pending', 'ready', 'superseded')),
  CHECK (segment_index >= 0),
  CHECK (manual_requested_project_override IN (0, 1)),
  CHECK (manual_category_override IN (0, 1))
);

CREATE UNIQUE INDEX uq_knowledge_source_segment_candidates_segment
  ON knowledge_source_segment_candidates (segment_id);

CREATE INDEX idx_knowledge_source_segment_candidates_source_status
  ON knowledge_source_segment_candidates (source_id, status);

CREATE INDEX idx_knowledge_source_segment_candidates_analysis_run
  ON knowledge_source_segment_candidates (analysis_run_id);
