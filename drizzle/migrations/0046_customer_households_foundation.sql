-- Task 14-B1: Family / Household schema foundation (ADDITIVE ONLY)
--
-- Rollback policy: do NOT drop these tables as a normal rollback.
-- If application code is reverted, tables remain dormant until a forward migration corrects schema.
-- No backfill. No existing Customer data is modified.

CREATE TABLE customer_households (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_from_customer_id TEXT,
  remark TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dissolved_at TEXT,
  dissolved_by TEXT,
  FOREIGN KEY (created_from_customer_id) REFERENCES customers (id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users (id),
  FOREIGN KEY (dissolved_by) REFERENCES users (id),
  CHECK (status IN ('active', 'dissolved'))
);

CREATE INDEX idx_customer_households_status
  ON customer_households (status);

CREATE INDEX idx_customer_households_created_from_customer_id
  ON customer_households (created_from_customer_id);

CREATE TABLE customer_household_members (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  joined_by TEXT NOT NULL,
  left_at TEXT,
  removed_by TEXT,
  FOREIGN KEY (household_id) REFERENCES customer_households (id),
  FOREIGN KEY (customer_id) REFERENCES customers (id),
  FOREIGN KEY (joined_by) REFERENCES users (id),
  FOREIGN KEY (removed_by) REFERENCES users (id)
);

CREATE INDEX idx_customer_household_members_household_id
  ON customer_household_members (household_id);

CREATE INDEX idx_customer_household_members_customer_id
  ON customer_household_members (customer_id);

-- One active household per Customer (left_at IS NULL).
CREATE UNIQUE INDEX uq_customer_household_members_customer_active
  ON customer_household_members (customer_id)
  WHERE left_at IS NULL;

CREATE TABLE customer_household_relationships (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  from_customer_id TEXT NOT NULL,
  to_customer_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  remark TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES customer_households (id),
  FOREIGN KEY (from_customer_id) REFERENCES customers (id),
  FOREIGN KEY (to_customer_id) REFERENCES customers (id),
  FOREIGN KEY (created_by) REFERENCES users (id),
  CHECK (from_customer_id != to_customer_id),
  CHECK (
    relationship_type IN (
      'father',
      'mother',
      'spouse',
      'son',
      'daughter',
      'child',
      'brother',
      'sister',
      'sibling',
      'grandfather',
      'grandmother',
      'grandparent',
      'grandson',
      'granddaughter',
      'grandchild',
      'other_relative'
    )
  )
);

CREATE UNIQUE INDEX uq_customer_household_relationships_directed
  ON customer_household_relationships (
    household_id,
    from_customer_id,
    to_customer_id
  );

CREATE INDEX idx_customer_household_relationships_household_id
  ON customer_household_relationships (household_id);

CREATE INDEX idx_customer_household_relationships_from_customer_id
  ON customer_household_relationships (from_customer_id);

CREATE INDEX idx_customer_household_relationships_to_customer_id
  ON customer_household_relationships (to_customer_id);
