-- Phase 5D-1: expand ai_insight_feedback for component targets + generation identity.
-- Do not apply with --remote until 5D-6.
-- Preserves all existing rows as feedback_target='legacy_overall' with rating_code NULL.
-- generation_key backfill must match TypeScript buildAiInsightGenerationKey():
--   trim(ai_insight_id) || '|' || trim(insight_generated_at) || '|' || trim(source_hash)
-- Delimiter '|' inside any part → leave generation_key NULL (legacy unique still applies).

PRAGMA foreign_keys = OFF;

CREATE TABLE ai_insight_feedback_new (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  ai_insight_id TEXT NOT NULL REFERENCES customer_ai_insights(id) ON DELETE CASCADE,
  insight_generated_at TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  rating INTEGER,
  reason_tags_json TEXT NOT NULL,
  comment TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id),
  generation_key TEXT,
  feedback_target TEXT NOT NULL,
  rating_code TEXT,
  provider_snapshot TEXT,
  contract_mode_snapshot TEXT,
  phase2_generated_snapshot INTEGER,
  actor_role_snapshot TEXT,
  degradation_reason_snapshot TEXT,
  CHECK (
    feedback_target IN (
      'legacy_overall',
      'base_deep',
      'phase2',
      'suggested_message'
    )
  ),
  CHECK (
    rating_code IS NULL
    OR rating_code IN ('helpful', 'not_helpful')
  ),
  CHECK (
    (
      feedback_target = 'legacy_overall'
      AND rating IS NOT NULL
      AND rating >= 1
      AND rating <= 5
      AND rating_code IS NULL
    )
    OR
    (
      feedback_target IN ('base_deep', 'phase2', 'suggested_message')
      AND rating IS NULL
      AND rating_code IN ('helpful', 'not_helpful')
      AND generation_key IS NOT NULL
      AND provider_snapshot IN (
        'google_gemini',
        'openai_compatible',
        'mock',
        'unknown'
      )
      AND contract_mode_snapshot IN (
        'gemini_flat',
        'rich',
        'none',
        'unknown'
      )
      AND phase2_generated_snapshot IN (0, 1)
      AND actor_role_snapshot IN ('admin', 'staff')
    )
  ),
  CHECK (
    provider_snapshot IS NULL
    OR provider_snapshot IN (
      'google_gemini',
      'openai_compatible',
      'mock',
      'unknown'
    )
  ),
  CHECK (
    contract_mode_snapshot IS NULL
    OR contract_mode_snapshot IN (
      'gemini_flat',
      'rich',
      'none',
      'unknown'
    )
  ),
  CHECK (
    phase2_generated_snapshot IS NULL
    OR phase2_generated_snapshot IN (0, 1)
  ),
  CHECK (
    actor_role_snapshot IS NULL
    OR actor_role_snapshot IN ('admin', 'staff')
  )
);

INSERT INTO ai_insight_feedback_new (
  id,
  customer_id,
  ai_insight_id,
  insight_generated_at,
  model,
  prompt_version,
  source_hash,
  rating,
  reason_tags_json,
  comment,
  created_by,
  created_at,
  updated_at,
  updated_by,
  generation_key,
  feedback_target,
  rating_code,
  provider_snapshot,
  contract_mode_snapshot,
  phase2_generated_snapshot,
  actor_role_snapshot,
  degradation_reason_snapshot
)
SELECT
  id,
  customer_id,
  ai_insight_id,
  insight_generated_at,
  model,
  prompt_version,
  source_hash,
  rating,
  reason_tags_json,
  comment,
  created_by,
  created_at,
  updated_at,
  updated_by,
  CASE
    WHEN length(trim(ai_insight_id)) > 0
      AND length(trim(insight_generated_at)) > 0
      AND length(trim(source_hash)) > 0
      AND instr(trim(ai_insight_id), '|') = 0
      AND instr(trim(insight_generated_at), '|') = 0
      AND instr(trim(source_hash), '|') = 0
    THEN trim(ai_insight_id) || '|' || trim(insight_generated_at) || '|' || trim(source_hash)
    ELSE NULL
  END,
  'legacy_overall',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL
FROM ai_insight_feedback;

DROP TABLE ai_insight_feedback;

ALTER TABLE ai_insight_feedback_new RENAME TO ai_insight_feedback;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_insight_feedback_legacy_customer_generated
  ON ai_insight_feedback(customer_id, insight_generated_at)
  WHERE feedback_target = 'legacy_overall';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_insight_feedback_component_generation_actor_target
  ON ai_insight_feedback(generation_key, created_by, feedback_target)
  WHERE feedback_target IN ('base_deep', 'phase2', 'suggested_message')
    AND generation_key IS NOT NULL;

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

CREATE INDEX IF NOT EXISTS idx_ai_insight_feedback_target_rating_created
  ON ai_insight_feedback(feedback_target, rating_code, created_at);

PRAGMA foreign_keys = ON;
