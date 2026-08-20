-- Phase 2C.9B: Company inbound fallback mailbox configuration
-- ADDITIVE ONLY. Depends on 0052–0062.
--
-- Purpose: durable singleton company Mail configuration for
--   inbound_fallback_mailbox_id — used when a known receiving route's
--   route-owner mailbox is archived or deleted and service policy selects fallback.
--
-- Empty table allowed after migration — no auto-selected fallback mailbox.
-- Service validates fallback target at configuration time (active shared mailbox).
-- Do NOT alter 0060/0061. Do NOT add routing columns to receiving addresses.

-- ---------------------------------------------------------------------------
-- mail_company_config — singleton company Mail routing configuration
--
-- id CHECK (id = 'default'): exactly one logical config row.
-- inbound_fallback_mailbox_id NOT NULL when row exists; zero rows = not configured.
-- No ON DELETE CASCADE — soft mailbox lifecycle must not silently erase config.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_company_config (
  id TEXT PRIMARY KEY NOT NULL,
  inbound_fallback_mailbox_id TEXT NOT NULL,
  updated_by_user_id TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (inbound_fallback_mailbox_id) REFERENCES mail_mailboxes (id),
  FOREIGN KEY (updated_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (id = 'default')
);
