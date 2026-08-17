-- Phase 2: separate Quick Entry channel from customer source.
-- Additive only — no backfill, no customers.source changes.
ALTER TABLE customers ADD COLUMN entry_method TEXT;
