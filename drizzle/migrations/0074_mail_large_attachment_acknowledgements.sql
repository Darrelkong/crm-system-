-- Phase V1: durable large-attachment risk acknowledgement evidence.
--
-- CREATE-only additive migration. It does not rebuild existing tables, delete
-- or update existing rows, backfill business data, create scanner state, or
-- enable large-attachment sending.

CREATE TABLE mail_large_attachment_acknowledgements (
  id TEXT PRIMARY KEY NOT NULL,
  upload_session_id TEXT NOT NULL,
  lifecycle_id TEXT,
  stored_file_id TEXT,
  user_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  mailbox_id TEXT NOT NULL,
  notice_version TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (upload_session_id)
    REFERENCES mail_large_attachment_upload_sessions (id)
    ON DELETE CASCADE,
  FOREIGN KEY (lifecycle_id)
    REFERENCES mail_large_attachment_lifecycle (id)
    ON DELETE CASCADE,
  FOREIGN KEY (stored_file_id)
    REFERENCES mail_stored_files (id)
    ON DELETE CASCADE,
  FOREIGN KEY (user_id)
    REFERENCES users (id),
  FOREIGN KEY (draft_id)
    REFERENCES mail_drafts (id),
  FOREIGN KEY (mailbox_id)
    REFERENCES mail_mailboxes (id),
  CHECK (length(trim(notice_version)) > 0),
  CHECK (length(trim(acknowledged_at)) > 0),
  CHECK (length(trim(created_at)) > 0)
);

CREATE UNIQUE INDEX uq_mail_large_attachment_ack_upload_session
  ON mail_large_attachment_acknowledgements (upload_session_id);

CREATE INDEX idx_mail_large_attachment_ack_lifecycle
  ON mail_large_attachment_acknowledgements (lifecycle_id);

CREATE INDEX idx_mail_large_attachment_ack_stored_file
  ON mail_large_attachment_acknowledgements (stored_file_id);

CREATE INDEX idx_mail_large_attachment_ack_user
  ON mail_large_attachment_acknowledgements (user_id);
