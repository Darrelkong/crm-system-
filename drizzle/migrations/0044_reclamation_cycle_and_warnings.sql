-- Phase 2: reclamation cycle anchor, rule-shortening grace, per-milestone warning dedup.

ALTER TABLE customers ADD COLUMN reclamation_cycle_started_at TEXT;
ALTER TABLE customers ADD COLUMN reclaim_rule_grace_until TEXT;

ALTER TABLE reclamation_warning_logs ADD COLUMN cycle_started_at TEXT;
ALTER TABLE reclamation_warning_logs ADD COLUMN warning_milestone INTEGER;
ALTER TABLE reclamation_warning_logs ADD COLUMN reclaim_days_snapshot INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reclamation_warning_cycle_milestone ON reclamation_warning_logs (
  customer_id,
  cycle_started_at,
  warning_milestone
);
