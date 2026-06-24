-- Migration: initial CRM schema (Phase 0)
-- Tables: users, sessions, customers, customer_contacts, follow_ups, tasks,
--         audit_logs, login_logs, system_settings

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_role ON users (role);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions (user_id);
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);

CREATE TABLE customers (
  id TEXT PRIMARY KEY NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT,
  wechat_id TEXT,
  email TEXT,
  source TEXT NOT NULL,
  source_remark TEXT,
  owner_id TEXT NOT NULL REFERENCES users (id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_by TEXT NOT NULL REFERENCES users (id),
  updated_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_customers_owner_id ON customers (owner_id);
CREATE INDEX idx_customers_created_at ON customers (created_at);
CREATE INDEX idx_customers_phone ON customers (phone);

CREATE TABLE customer_contacts (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  wechat_id TEXT,
  email TEXT,
  title TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_customer_contacts_customer_id ON customer_contacts (customer_id);

CREATE TABLE follow_ups (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id),
  content TEXT NOT NULL,
  follow_up_type TEXT,
  next_follow_up_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_follow_ups_customer_id ON follow_ups (customer_id);
CREATE INDEX idx_follow_ups_user_id ON follow_ups (user_id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT REFERENCES customers (id) ON DELETE SET NULL,
  assigned_to TEXT NOT NULL REFERENCES users (id),
  created_by TEXT NOT NULL REFERENCES users (id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'cancelled')),
  due_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_tasks_assigned_to ON tasks (assigned_to);
CREATE INDEX idx_tasks_customer_id ON tasks (customer_id);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs (action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at);

CREATE TABLE login_logs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  email_attempted TEXT NOT NULL,
  success INTEGER NOT NULL,
  failure_reason TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_login_logs_email ON login_logs (email_attempted);
CREATE INDEX idx_login_logs_created_at ON login_logs (created_at);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);
