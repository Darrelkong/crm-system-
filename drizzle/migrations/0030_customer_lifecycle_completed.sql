-- CUSTOMER-FLOW-3A: Admin marks paid customers as lifecycle completed

ALTER TABLE customers ADD COLUMN lifecycle_status TEXT;
ALTER TABLE customers ADD COLUMN lifecycle_completed_at TEXT;
ALTER TABLE customers ADD COLUMN lifecycle_completed_by TEXT REFERENCES users(id);
ALTER TABLE customers ADD COLUMN lifecycle_completion_notes TEXT;
