-- Country/region requested-project selector: nullable catalog code.
-- Legacy rows keep requested_project_code NULL; no backfill.

ALTER TABLE customers ADD COLUMN requested_project_code TEXT NULL;
