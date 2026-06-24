-- Migration: public pool fields on customers (Phase 6)

ALTER TABLE customers ADD COLUMN pool_entered_at TEXT;
ALTER TABLE customers ADD COLUMN pool_reason TEXT;
ALTER TABLE customers ADD COLUMN released_by TEXT REFERENCES users (id);
ALTER TABLE customers ADD COLUMN previous_owner_id TEXT REFERENCES users (id);
ALTER TABLE customers ADD COLUMN claimed_by TEXT REFERENCES users (id);
ALTER TABLE customers ADD COLUMN claimed_at TEXT;
ALTER TABLE customers ADD COLUMN pool_left_at TEXT;

CREATE INDEX idx_customers_pool_entered_at ON customers (pool_entered_at);
CREATE INDEX idx_customers_claimed_by ON customers (claimed_by);
CREATE INDEX idx_customers_claimed_at ON customers (claimed_at);

-- Backfill existing public pool rows
UPDATE customers
SET released_by = releaser_user_id
WHERE released_by IS NULL AND releaser_user_id IS NOT NULL;

UPDATE customers
SET pool_entered_at = created_at
WHERE status = 'public_pool' AND pool_entered_at IS NULL;
