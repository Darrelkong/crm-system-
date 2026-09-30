-- Smart Ingest 2A: explicit default mapping from CRM requested_project_code to Knowledge category.
CREATE TABLE knowledge_business_category_mappings (
  id TEXT PRIMARY KEY NOT NULL,
  requested_project_code TEXT NOT NULL,
  knowledge_category_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (knowledge_category_id) REFERENCES knowledge_categories (id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX uq_knowledge_business_category_mappings_code
  ON knowledge_business_category_mappings (requested_project_code);

CREATE INDEX idx_knowledge_business_category_mappings_category
  ON knowledge_business_category_mappings (knowledge_category_id);
