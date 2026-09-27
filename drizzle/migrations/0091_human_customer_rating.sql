-- Human-confirmed customer rating. 0087-0090 are reserved for SI2 and independent.
-- No data inference/backfill: existing customers become NULL / revision 0.
ALTER TABLE customers ADD COLUMN customer_rating TEXT
  CONSTRAINT ck_customers_rating CHECK (customer_rating IS NULL OR customer_rating IN ('S','A','B','D'));
ALTER TABLE customers ADD COLUMN customer_rating_revision INTEGER NOT NULL DEFAULT 0
  CONSTRAINT ck_customers_rating_revision CHECK (typeof(customer_rating_revision) = 'integer' AND customer_rating_revision >= 0);

CREATE TABLE customer_rating_history (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  follow_up_id TEXT REFERENCES follow_ups(id) ON DELETE SET NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rating_before TEXT,
  rating_after TEXT,
  action TEXT NOT NULL,
  revision_before INTEGER NOT NULL,
  revision_after INTEGER NOT NULL,
  reason TEXT,
  recorded_at TEXT NOT NULL,
  CONSTRAINT ck_rating_history_before CHECK (rating_before IS NULL OR rating_before IN ('S','A','B','D')),
  CONSTRAINT ck_rating_history_after CHECK (rating_after IS NULL OR rating_after IN ('S','A','B','D')),
  CONSTRAINT ck_rating_history_action CHECK (action IN ('follow_up_confirmed','manual_correction','manual_clear')),
  CONSTRAINT ck_rating_history_revision CHECK (typeof(revision_before) = 'integer' AND typeof(revision_after) = 'integer' AND revision_before >= 0 AND revision_after = revision_before + 1),
  -- A confirmed event may lose its follow-up FK later; retain the human decision.
  CONSTRAINT ck_rating_history_action_shape CHECK (
    (action = 'follow_up_confirmed' AND rating_after IS NOT NULL)
    OR (action = 'manual_correction' AND follow_up_id IS NULL AND rating_after IS NOT NULL AND reason IS NOT NULL AND length(trim(reason)) >= 5)
    OR (action = 'manual_clear' AND follow_up_id IS NULL AND rating_before IS NOT NULL AND rating_after IS NULL AND reason IS NOT NULL AND length(trim(reason)) >= 5)
  )
);
CREATE UNIQUE INDEX uq_customer_rating_history_follow_up
  ON customer_rating_history(follow_up_id) WHERE follow_up_id IS NOT NULL;
CREATE INDEX idx_customer_rating_history_customer_recorded
  ON customer_rating_history(customer_id, recorded_at, id);
