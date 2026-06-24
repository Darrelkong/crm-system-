-- Fix tasks table: replace legacy status CHECK with open/completed/cancelled (Phase 5)

CREATE TABLE tasks_new (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT REFERENCES customers (id) ON DELETE SET NULL,
  assigned_to TEXT NOT NULL REFERENCES users (id),
  created_by TEXT NOT NULL REFERENCES users (id),
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'follow_up',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  due_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO tasks_new (
  id, customer_id, assigned_to, created_by, title, description, type, status,
  due_at, completed_at, created_at, updated_at
)
SELECT
  id, customer_id, assigned_to, created_by, title, description,
  COALESCE(type, 'follow_up'),
  CASE
    WHEN status IN ('done', 'completed') THEN 'completed'
    WHEN status = 'cancelled' THEN 'cancelled'
    ELSE 'open'
  END,
  due_at, completed_at, created_at, updated_at
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX idx_tasks_assigned_to ON tasks (assigned_to);
CREATE INDEX idx_tasks_customer_id ON tasks (customer_id);
CREATE INDEX idx_tasks_status ON tasks (status);
CREATE INDEX idx_tasks_due_at ON tasks (due_at);
