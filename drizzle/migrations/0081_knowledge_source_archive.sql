-- Knowledge Phase 2A: non-destructive source archive lifecycle.
--
-- Archive is orthogonal to workflow status (ready, organized, converted, etc.).
-- Existing rows remain active with archived_at = NULL.

ALTER TABLE knowledge_sources ADD COLUMN archived_at TEXT;
ALTER TABLE knowledge_sources ADD COLUMN archived_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX idx_knowledge_sources_active_updated
  ON knowledge_sources (updated_at)
  WHERE archived_at IS NULL;

CREATE INDEX idx_knowledge_sources_archived_updated
  ON knowledge_sources (archived_at, updated_at)
  WHERE archived_at IS NOT NULL;
