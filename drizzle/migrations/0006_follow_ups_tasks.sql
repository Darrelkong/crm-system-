-- Migration: follow-up timestamps on customers, expanded follow_ups, task type/status (Phase 5)

ALTER TABLE customers ADD COLUMN last_follow_up_at TEXT;
ALTER TABLE customers ADD COLUMN last_valid_follow_up_at TEXT;
ALTER TABLE customers ADD COLUMN next_follow_up_at TEXT;

ALTER TABLE follow_ups ADD COLUMN follow_up_time TEXT;
ALTER TABLE follow_ups ADD COLUMN channel TEXT;
ALTER TABLE follow_ups ADD COLUMN outcome TEXT;
ALTER TABLE follow_ups ADD COLUMN summary TEXT;
ALTER TABLE follow_ups ADD COLUMN customer_intent TEXT;
ALTER TABLE follow_ups ADD COLUMN next_action TEXT;
ALTER TABLE follow_ups ADD COLUMN is_valid_follow_up INTEGER NOT NULL DEFAULT 0;

UPDATE follow_ups SET summary = content WHERE summary IS NULL AND content IS NOT NULL;

ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'follow_up';

UPDATE tasks SET status = 'open' WHERE status IN ('pending', 'in_progress');
UPDATE tasks SET status = 'completed' WHERE status = 'done';
