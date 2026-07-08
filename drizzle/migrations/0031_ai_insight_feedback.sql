-- AI insight admin feedback (rating + reason tags)

CREATE TABLE IF NOT EXISTS ai_insight_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  ai_insight_id TEXT NOT NULL REFERENCES customer_ai_insights(id) ON DELETE CASCADE,
  insight_generated_at TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  rating INTEGER NOT NULL,
  reason_tags_json TEXT NOT NULL,
  comment TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_insight_feedback_customer_generated
  ON ai_insight_feedback(customer_id, insight_generated_at);

CREATE INDEX IF NOT EXISTS idx_ai_insight_feedback_customer_id
  ON ai_insight_feedback(customer_id);

CREATE INDEX IF NOT EXISTS idx_ai_insight_feedback_ai_insight_id
  ON ai_insight_feedback(ai_insight_id);

CREATE INDEX IF NOT EXISTS idx_ai_insight_feedback_created_at
  ON ai_insight_feedback(created_at);

CREATE INDEX IF NOT EXISTS idx_ai_insight_feedback_model
  ON ai_insight_feedback(model);

CREATE INDEX IF NOT EXISTS idx_ai_insight_feedback_prompt_version
  ON ai_insight_feedback(prompt_version);
