-- Phase SAFE-1A: customer recycle bin metadata on archived customers

ALTER TABLE customers ADD COLUMN deleted_at TEXT;
ALTER TABLE customers ADD COLUMN deleted_by TEXT REFERENCES users(id);
ALTER TABLE customers ADD COLUMN deleted_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_deleted_at ON customers(deleted_at);

UPDATE customers
SET deleted_at = updated_at
WHERE status = 'archived' AND deleted_at IS NULL;
