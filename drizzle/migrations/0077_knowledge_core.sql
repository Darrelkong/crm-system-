-- Knowledge Phase 1 Package 2: categories, articles, and immutable versions.
--
-- This migration is additive and independent from CRM customer, Mail, AI,
-- approval, and external-sharing state. Article history is intentionally
-- protected from accidental cascade deletion.

CREATE TABLE knowledge_categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  slug TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (length(trim(name)) > 0),
  CHECK (length(trim(slug)) > 0),
  CHECK (sort_order >= 0),
  CHECK (is_active IN (0, 1)),
  CHECK (length(trim(created_at)) > 0),
  CHECK (length(trim(updated_at)) > 0)
);

CREATE UNIQUE INDEX uq_knowledge_categories_slug
  ON knowledge_categories (slug);

CREATE INDEX idx_knowledge_categories_active_order
  ON knowledge_categories (is_active, sort_order);

CREATE TABLE knowledge_articles (
  id TEXT PRIMARY KEY NOT NULL,
  category_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  visibility TEXT NOT NULL DEFAULT 'team',
  owner_user_id TEXT,
  current_version_number INTEGER NOT NULL DEFAULT 1,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (category_id)
    REFERENCES knowledge_categories (id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (length(trim(title)) > 0),
  CHECK (length(trim(body)) > 0),
  CHECK (status IN ('draft', 'published', 'archived')),
  CHECK (visibility IN ('team', 'restricted', 'owner')),
  CHECK (current_version_number >= 1),
  CHECK (visibility <> 'owner' OR owner_user_id IS NOT NULL),
  CHECK (status <> 'archived' OR archived_at IS NOT NULL),
  CHECK (length(trim(created_at)) > 0),
  CHECK (length(trim(updated_at)) > 0)
);

CREATE INDEX idx_knowledge_articles_category_status
  ON knowledge_articles (category_id, status);

CREATE INDEX idx_knowledge_articles_updated_at
  ON knowledge_articles (updated_at);

CREATE TABLE knowledge_article_versions (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  title_snapshot TEXT NOT NULL,
  summary_snapshot TEXT,
  body_snapshot TEXT NOT NULL,
  category_id_snapshot TEXT NOT NULL,
  visibility_snapshot TEXT NOT NULL,
  owner_user_id_snapshot TEXT,
  change_note TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id)
    REFERENCES knowledge_articles (id) ON DELETE RESTRICT,
  FOREIGN KEY (category_id_snapshot)
    REFERENCES knowledge_categories (id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_user_id_snapshot) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (version_number >= 1),
  CHECK (length(trim(title_snapshot)) > 0),
  CHECK (length(trim(body_snapshot)) > 0),
  CHECK (visibility_snapshot IN ('team', 'restricted', 'owner')),
  CHECK (
    visibility_snapshot <> 'owner' OR owner_user_id_snapshot IS NOT NULL
  ),
  CHECK (length(trim(created_at)) > 0)
);

CREATE UNIQUE INDEX uq_knowledge_article_versions_article_number
  ON knowledge_article_versions (article_id, version_number);

CREATE INDEX idx_knowledge_article_versions_article_created
  ON knowledge_article_versions (article_id, created_at);
