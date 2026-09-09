-- Knowledge Phase 1 Package 4: review workflow and immutable publications.
--
-- The article row remains the working copy. Viewer reads must resolve the
-- explicit published_version_number to an immutable version snapshot.

ALTER TABLE knowledge_articles
  ADD COLUMN published_version_number INTEGER;

CREATE TABLE knowledge_review_requests (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL,
  submitted_version_number INTEGER NOT NULL,
  submitted_by_user_id TEXT NOT NULL,
  assigned_reviewer_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  submission_note TEXT,
  review_note TEXT,
  due_at TEXT,
  submitted_at TEXT NOT NULL,
  review_started_at TEXT,
  decided_at TEXT,
  decided_by_user_id TEXT,
  withdrawn_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES knowledge_articles (id) ON DELETE RESTRICT,
  FOREIGN KEY (submitted_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  FOREIGN KEY (assigned_reviewer_user_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (decided_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (status IN ('pending', 'changes_requested', 'approved', 'withdrawn', 'superseded')),
  CHECK (submitted_version_number >= 1),
  CHECK (
    status IN ('pending', 'changes_requested')
    OR decided_at IS NOT NULL
    OR withdrawn_at IS NOT NULL
  )
);

CREATE INDEX idx_knowledge_review_requests_status_updated
  ON knowledge_review_requests (status, updated_at);

CREATE INDEX idx_knowledge_review_requests_article_created
  ON knowledge_review_requests (article_id, created_at);

CREATE INDEX idx_knowledge_review_requests_reviewer_status
  ON knowledge_review_requests (assigned_reviewer_user_id, status);

CREATE UNIQUE INDEX uq_knowledge_review_requests_active_article
  ON knowledge_review_requests (article_id)
  WHERE status = 'pending';

CREATE TABLE knowledge_article_publications (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  review_request_id TEXT NOT NULL,
  published_by_user_id TEXT NOT NULL,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES knowledge_articles (id) ON DELETE RESTRICT,
  FOREIGN KEY (article_id, version_number)
    REFERENCES knowledge_article_versions (article_id, version_number)
    ON DELETE RESTRICT,
  FOREIGN KEY (review_request_id)
    REFERENCES knowledge_review_requests (id) ON DELETE RESTRICT,
  FOREIGN KEY (published_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CHECK (version_number >= 1)
);

CREATE UNIQUE INDEX uq_knowledge_article_publications_review
  ON knowledge_article_publications (review_request_id);

CREATE UNIQUE INDEX uq_knowledge_article_publications_article_version
  ON knowledge_article_publications (article_id, version_number);

CREATE INDEX idx_knowledge_article_publications_article_time
  ON knowledge_article_publications (article_id, published_at);
