-- Phase 1 customer profile: optional nullable columns on customers.
-- Do not rebuild the table; do not mutate existing rows; no defaults / indexes / CHECKs.
-- Enum validation is enforced in application code (src/lib/customers/customer-profile.ts).

ALTER TABLE customers ADD COLUMN preferred_name TEXT;
ALTER TABLE customers ADD COLUMN gender TEXT;
ALTER TABLE customers ADD COLUMN age_range TEXT;
ALTER TABLE customers ADD COLUMN preferred_language TEXT;
ALTER TABLE customers ADD COLUMN preferred_contact_method TEXT;
ALTER TABLE customers ADD COLUMN occupation TEXT;
ALTER TABLE customers ADD COLUMN company_name TEXT;
ALTER TABLE customers ADD COLUMN job_title TEXT;
ALTER TABLE customers ADD COLUMN target_country_or_region TEXT;
ALTER TABLE customers ADD COLUMN primary_concern TEXT;
