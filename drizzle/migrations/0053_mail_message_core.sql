-- Phase 2B.3: Mail core message layer (threads, messages, bodies, recipients, read states)
-- ADDITIVE ONLY. No seed data. Depends on 0052_mail_foundation.sql.
--
-- Rollback policy: do NOT drop these tables as a normal rollback.
-- Mail historical records must not be destroyed by accidental CASCADE.
--
-- Future atomic writes: use env.DB.batch([...]) — not D1Database.transaction().

-- ---------------------------------------------------------------------------
-- mail_threads — mailbox-scoped conversation grouping (V1: one thread = one mailbox)
--
-- root_message_id intentionally omitted: first/root message is derived by
-- ordering messages in the thread (received_at / created_at).
-- ---------------------------------------------------------------------------
CREATE TABLE mail_threads (
  id TEXT PRIMARY KEY NOT NULL,
  mailbox_id TEXT NOT NULL,
  subject_normalized TEXT,
  last_message_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (mailbox_id) REFERENCES mail_mailboxes (id),
  UNIQUE (id, mailbox_id)
);

CREATE INDEX idx_mail_threads_mailbox_last_message
  ON mail_threads (mailbox_id, last_message_at);

-- ---------------------------------------------------------------------------
-- mail_messages — canonical persisted message (NOT draft / approval / transport)
--
-- Thread ↔ mailbox invariant: composite FK (thread_id, mailbox_id) prevents a
-- message from belonging to a different mailbox than its thread.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  mailbox_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  sender_identity_id TEXT,
  from_address TEXT NOT NULL,
  from_display_name TEXT,
  subject TEXT NOT NULL,
  subject_normalized TEXT,
  preview_text TEXT NOT NULL DEFAULT '',
  sensitivity TEXT NOT NULL DEFAULT 'normal',
  internet_message_id TEXT,
  in_reply_to TEXT,
  references_header TEXT,
  reply_to_message_id TEXT,
  compose_mode TEXT,
  received_at TEXT,
  sent_at TEXT,
  trashed_at TEXT,
  trashed_by TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (thread_id, mailbox_id) REFERENCES mail_threads (id, mailbox_id),
  FOREIGN KEY (mailbox_id) REFERENCES mail_mailboxes (id),
  FOREIGN KEY (sender_identity_id) REFERENCES mail_sender_identities (id) ON DELETE SET NULL,
  FOREIGN KEY (reply_to_message_id) REFERENCES mail_messages (id),
  FOREIGN KEY (trashed_by) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (direction IN ('inbound', 'outbound')),
  CHECK (sensitivity IN ('normal', 'sensitive', 'restricted')),
  -- SQLite treats CHECK expressions that evaluate to NULL as satisfied.
  -- Outbound must use compose_mode IS NOT NULL explicitly; NULL IN (...) is not a rejection.
  CHECK (
    (direction = 'inbound'
      AND sender_identity_id IS NULL
      AND compose_mode IS NULL
      AND received_at IS NOT NULL)
    OR
    (direction = 'outbound'
      AND sender_identity_id IS NOT NULL
      AND compose_mode IS NOT NULL
      AND compose_mode IN ('new', 'reply', 'reply_all', 'forward'))
  )
);

CREATE INDEX idx_mail_messages_mailbox_direction_received
  ON mail_messages (mailbox_id, direction, received_at);

CREATE INDEX idx_mail_messages_mailbox_direction_sent
  ON mail_messages (mailbox_id, direction, sent_at);

CREATE INDEX idx_mail_messages_thread_created
  ON mail_messages (thread_id, created_at);

CREATE INDEX idx_mail_messages_mailbox_not_trashed
  ON mail_messages (mailbox_id, created_at)
  WHERE trashed_at IS NULL;

-- Inbound RFC Message-ID dedup is mailbox-scoped (not global).
CREATE UNIQUE INDEX uq_mail_messages_inbound_internet_message_id
  ON mail_messages (mailbox_id, internet_message_id)
  WHERE internet_message_id IS NOT NULL AND direction = 'inbound';

-- ---------------------------------------------------------------------------
-- mail_message_bodies — 1:1 large body payload (kept off narrow message list row)
--
-- body_html_sanitized / quoted_html_sanitized: server-sanitized HTML ONLY.
-- Never persist arbitrary client HTML. Sanitizer runs at ingress (inbound) or
-- is materialized from immutable outbound revision (outbound).
-- Raw MIME storage is deferred.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_message_bodies (
  message_id TEXT PRIMARY KEY NOT NULL,
  body_text TEXT NOT NULL DEFAULT '',
  body_html_sanitized TEXT,
  quoted_text TEXT,
  quoted_html_sanitized TEXT,
  sanitization_version TEXT NOT NULL DEFAULT '1',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES mail_messages (id)
);

-- ---------------------------------------------------------------------------
-- mail_message_recipients — normalized To/Cc/Bcc
--
-- Uniqueness is per message across ALL recipient types (not per type).
-- Case-insensitive via lower(address). Max 50 recipients: service layer only.
--
-- SECURITY-CRITICAL: Bcc rows exist for outbound audit/history but must NOT
-- be returned to every Mail reader. Future API filters by authorization.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_message_recipients (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL,
  recipient_type TEXT NOT NULL,
  address TEXT NOT NULL,
  display_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES mail_messages (id),
  CHECK (recipient_type IN ('to', 'cc', 'bcc'))
);

CREATE INDEX idx_mail_message_recipients_message_id
  ON mail_message_recipients (message_id);

CREATE UNIQUE INDEX uq_mail_message_recipients_message_address
  ON mail_message_recipients (message_id, lower(address));

-- ---------------------------------------------------------------------------
-- mail_message_read_states — per-user read + personal Important
--
-- No row semantic (recommended):
--   absent row => unread (is_read=0) AND not personally important.
-- Avoids eager read-state rows for every authorized shared-mailbox viewer.
--
-- Mark read:   is_read=1, read_at set
-- Mark unread: is_read=0, read_at=NULL (row may remain; Important unchanged)
-- ---------------------------------------------------------------------------
CREATE TABLE mail_message_read_states (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  is_important_personal INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (message_id) REFERENCES mail_messages (id),
  FOREIGN KEY (user_id) REFERENCES users (id),
  CHECK (is_read IN (0, 1)),
  CHECK (is_important_personal IN (0, 1)),
  CHECK (
    (is_read = 1 AND read_at IS NOT NULL)
    OR (is_read = 0 AND read_at IS NULL)
  )
);

CREATE INDEX idx_mail_message_read_states_user_read
  ON mail_message_read_states (user_id, is_read);
