-- Phase 2A: customer_contact_identifiers foundation (no global unique yet).
-- Per-customer unique only via uq_customer_contact_identifiers_customer_type_value.
-- Global UNIQUE(contact_type, normalized_value) is reserved for 0042.

CREATE TABLE customer_contact_identifiers (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL CHECK (
    contact_type IN ('phone', 'wechat_id', 'email')
  ),
  normalized_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_customer_contact_identifiers_customer_type_value
  ON customer_contact_identifiers (customer_id, contact_type, normalized_value);

CREATE INDEX idx_customer_contact_identifiers_customer_id
  ON customer_contact_identifiers (customer_id);
