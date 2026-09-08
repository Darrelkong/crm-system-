-- Knowledge Phase 1 Package 1: independent foundation.
--
-- This migration intentionally creates no article, customer, R2, AI, search,
-- or Mail state. The policy row is created only by the first-time bootstrap.

CREATE TABLE knowledge_access_policy (
  id TEXT PRIMARY KEY NOT NULL,
  password_hash TEXT NOT NULL,
  password_version INTEGER NOT NULL DEFAULT 1,
  initialized_by TEXT,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (initialized_by) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (id = 'singleton'),
  CHECK (password_version >= 1),
  CHECK (length(trim(password_hash)) > 0),
  CHECK (length(trim(created_at)) > 0),
  CHECK (length(trim(updated_at)) > 0)
);

CREATE TABLE knowledge_session_unlocks (
  session_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  password_version_at_unlock INTEGER,
  unlocked_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CHECK (failed_attempts >= 0 AND failed_attempts <= 5),
  CHECK (length(trim(updated_at)) > 0)
);

CREATE INDEX idx_knowledge_session_unlocks_user_id
  ON knowledge_session_unlocks (user_id);

CREATE INDEX idx_knowledge_session_unlocks_locked_until
  ON knowledge_session_unlocks (locked_until);

CREATE TABLE knowledge_user_roles (
  user_id TEXT PRIMARY KEY NOT NULL,
  role TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (
    role IN ('viewer', 'contributor', 'reviewer', 'knowledge_admin')
  ),
  CHECK (length(trim(created_at)) > 0),
  CHECK (length(trim(updated_at)) > 0)
);

CREATE INDEX idx_knowledge_user_roles_role
  ON knowledge_user_roles (role);
