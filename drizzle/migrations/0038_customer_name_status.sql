-- Phase 2B: pending vs confirmed customer name status
-- Existing rows receive DEFAULT 'confirmed' automatically.

ALTER TABLE customers ADD COLUMN name_status TEXT NOT NULL DEFAULT 'confirmed';
