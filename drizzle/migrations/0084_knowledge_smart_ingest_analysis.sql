-- Smart Ingest Gate 1: paste analysis runs + deterministic segments

ALTER TABLE knowledge_sources ADD COLUMN analysis_status TEXT NOT NULL DEFAULT 'none';

CREATE TABLE knowledge_source_analysis_runs (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES knowledge_sources (id) ON DELETE RESTRICT,
  requested_by_user_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending',
  schema_version TEXT NOT NULL,
  segmentation_mode TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  CHECK (length(trim(schema_version)) > 0),
  CHECK (length(trim(segmentation_mode)) > 0)
);

CREATE INDEX idx_knowledge_analysis_runs_source_created
  ON knowledge_source_analysis_runs (source_id, created_at);

CREATE UNIQUE INDEX uq_knowledge_analysis_runs_active_source
  ON knowledge_source_analysis_runs (source_id)
  WHERE status IN ('pending', 'processing');

CREATE TABLE knowledge_source_segments (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES knowledge_sources (id) ON DELETE RESTRICT,
  analysis_run_id TEXT NOT NULL REFERENCES knowledge_source_analysis_runs (id) ON DELETE RESTRICT,
  segment_index INTEGER NOT NULL,
  title_hint TEXT NOT NULL,
  evidence_text TEXT NOT NULL,
  evidence_start INTEGER NOT NULL,
  evidence_end INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL,
  CHECK (status IN ('proposed', 'rejected', 'superseded')),
  CHECK (segment_index >= 0),
  CHECK (evidence_start >= 0),
  CHECK (evidence_end >= evidence_start),
  CHECK (length(trim(title_hint)) > 0),
  CHECK (length(evidence_text) > 0)
);

CREATE INDEX idx_knowledge_source_segments_source_index
  ON knowledge_source_segments (source_id, segment_index);

CREATE INDEX idx_knowledge_source_segments_run
  ON knowledge_source_segments (analysis_run_id);

CREATE INDEX idx_knowledge_sources_analysis_status
  ON knowledge_sources (analysis_status, updated_at);
