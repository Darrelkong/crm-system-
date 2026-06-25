-- Phase 1A: AI customer intent insights (read-only suggestions)

CREATE TABLE IF NOT EXISTS customer_ai_insights (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  intent_level TEXT NOT NULL,
  intent_score INTEGER NOT NULL,
  customer_summary TEXT NOT NULL,
  current_situation TEXT NOT NULL,
  key_signals_json TEXT NOT NULL,
  risk_flags_json TEXT NOT NULL,
  missing_information_json TEXT NOT NULL,
  next_best_action TEXT NOT NULL,
  suggested_follow_up_at TEXT,
  suggested_employee_message TEXT NOT NULL,
  confidence REAL NOT NULL,
  reasoning TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_ai_insights_customer_id ON customer_ai_insights(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_ai_insights_source_hash ON customer_ai_insights(source_hash);
