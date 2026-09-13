-- P2C-B1: additive extraction metadata for Vision image ingest (local apply only).
ALTER TABLE knowledge_sources ADD COLUMN extraction_method TEXT;
ALTER TABLE knowledge_sources ADD COLUMN extraction_model TEXT;
ALTER TABLE knowledge_sources ADD COLUMN extraction_metadata_json TEXT;
ALTER TABLE knowledge_sources ADD COLUMN page_count INTEGER;
