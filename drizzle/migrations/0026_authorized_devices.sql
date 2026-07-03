-- Device authorization: authorized_devices table + sessions.device_id_hash

CREATE TABLE authorized_devices (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id_hash TEXT NOT NULL,
  device_name TEXT,
  user_agent TEXT,
  ip_address TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  approved_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  approved_at TEXT,
  revoked_at TEXT,
  last_seen_at TEXT,
  last_seen_ip TEXT,
  last_seen_user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_authorized_devices_user_hash
  ON authorized_devices (user_id, device_id_hash);
CREATE INDEX idx_authorized_devices_status ON authorized_devices (status);
CREATE INDEX idx_authorized_devices_user_status
  ON authorized_devices (user_id, status);
CREATE INDEX idx_authorized_devices_created_at ON authorized_devices (created_at);

ALTER TABLE sessions ADD COLUMN device_id_hash TEXT;
CREATE INDEX idx_sessions_device_id_hash ON sessions (device_id_hash);

INSERT OR IGNORE INTO system_settings (key, value, updated_at)
VALUES ('device_authorization_enabled', 'false', datetime('now'));

INSERT OR IGNORE INTO system_settings (key, value, updated_at)
VALUES ('device_authorization_limit_per_user', '2', datetime('now'));
