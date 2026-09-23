-- Add human-confirmed segment status for Smart Ingest topic review

PRAGMA foreign_keys = OFF;

CREATE TABLE knowledge_source_segments_new (
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
  CHECK (status IN ('proposed', 'confirmed', 'rejected', 'superseded')),
  CHECK (segment_index >= 0),
  CHECK (evidence_start >= 0),
  CHECK (evidence_end >= evidence_start),
  CHECK (length(trim(title_hint)) > 0),
  CHECK (length(evidence_text) > 0)
);

INSERT INTO knowledge_source_segments_new
SELECT
  id,
  source_id,
  analysis_run_id,
  segment_index,
  title_hint,
  evidence_text,
  evidence_start,
  evidence_end,
  status,
  created_at
FROM knowledge_source_segments;

DROP TABLE knowledge_source_segments;

ALTER TABLE knowledge_source_segments_new RENAME TO knowledge_source_segments;

CREATE INDEX idx_knowledge_source_segments_source_index
  ON knowledge_source_segments (source_id, segment_index);

CREATE INDEX idx_knowledge_source_segments_run
  ON knowledge_source_segments (analysis_run_id);

PRAGMA foreign_keys = ON;
