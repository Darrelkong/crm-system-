-- Migration: announcements for admin-managed notices (Phase 12)
CREATE TABLE announcements (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  audience TEXT NOT NULL DEFAULT 'all',
  created_by TEXT NOT NULL REFERENCES users(id),
  published_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_announcements_status ON announcements(status);
CREATE INDEX idx_announcements_audience ON announcements(audience);
CREATE INDEX idx_announcements_published_at ON announcements(published_at);
CREATE INDEX idx_announcements_created_at ON announcements(created_at);
