-- C-3: collaborative dissolution foundation (dry-run only; no auto-execution in this phase)

ALTER TABLE customers ADD COLUMN collaborative_dissolved_at TEXT;

INSERT OR IGNORE INTO system_settings (key, value, updated_at)
VALUES ('collaborative_dissolution_enabled', 'false', datetime('now'));
