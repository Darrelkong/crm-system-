-- Phase 18B: unique customer code (EF000001 format)

ALTER TABLE customers ADD COLUMN customer_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_customer_code ON customers(customer_code);

WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM customers
)
UPDATE customers
SET customer_code = 'EF' || printf('%06d', (
  SELECT rn FROM ordered WHERE ordered.id = customers.id
))
WHERE customer_code IS NULL;

CREATE TABLE IF NOT EXISTS customer_code_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_number INTEGER NOT NULL
);

INSERT INTO customer_code_counter (id, last_number)
SELECT
  1,
  COALESCE(
    (
      SELECT MAX(CAST(SUBSTR(customer_code, 3) AS INTEGER))
      FROM customers
      WHERE customer_code GLOB 'EF[0-9][0-9][0-9][0-9][0-9][0-9]'
    ),
    0
  )
ON CONFLICT(id) DO UPDATE SET
  last_number = excluded.last_number;
