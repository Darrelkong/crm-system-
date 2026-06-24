-- Migration: public pool support and customer notes
PRAGMA foreign_keys=OFF;

CREATE TABLE customers_new (
  id TEXT PRIMARY KEY NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT,
  wechat_id TEXT,
  email TEXT,
  source TEXT NOT NULL,
  source_remark TEXT,
  notes TEXT,
  owner_id TEXT REFERENCES users (id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'inactive', 'archived', 'public_pool')
  ),
  releaser_user_id TEXT REFERENCES users (id),
  created_by TEXT NOT NULL REFERENCES users (id),
  updated_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO customers_new (
  id,
  customer_name,
  phone,
  wechat_id,
  email,
  source,
  source_remark,
  notes,
  owner_id,
  status,
  releaser_user_id,
  created_by,
  updated_by,
  created_at,
  updated_at
)
SELECT
  id,
  customer_name,
  phone,
  wechat_id,
  email,
  source,
  source_remark,
  NULL,
  owner_id,
  status,
  NULL,
  created_by,
  updated_by,
  created_at,
  updated_at
FROM customers;

DROP TABLE customers;
ALTER TABLE customers_new RENAME TO customers;

CREATE INDEX idx_customers_owner_id ON customers (owner_id);
CREATE INDEX idx_customers_created_at ON customers (created_at);
CREATE INDEX idx_customers_phone ON customers (phone);
CREATE INDEX idx_customers_status ON customers (status);
CREATE INDEX idx_customers_releaser_user_id ON customers (releaser_user_id);

PRAGMA foreign_keys=ON;
