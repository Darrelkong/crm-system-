ALTER TABLE users ADD COLUMN first_login_at TEXT;
ALTER TABLE users ADD COLUMN pool_claim_paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pool_claim_quota_override INTEGER;
ALTER TABLE users ADD COLUMN pool_claim_cooldown_hours_override INTEGER;

UPDATE users
SET first_login_at = (
  SELECT MIN(login_logs.created_at)
  FROM login_logs
  WHERE login_logs.user_id = users.id
    AND login_logs.success = 1
)
WHERE first_login_at IS NULL;
