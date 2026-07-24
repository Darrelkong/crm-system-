-- Phase 5C-1: store server-composed Final Phase2Insight JSON on customer insights.
-- Nullable, no default, no backfill. Old rows remain NULL.
-- Local migration only in this phase — do not apply with --remote.

ALTER TABLE customer_ai_insights
ADD COLUMN phase2_json TEXT;
