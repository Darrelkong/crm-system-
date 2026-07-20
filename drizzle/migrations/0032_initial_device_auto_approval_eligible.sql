-- One-time eligibility for Staff first-device auto-approval after forced password change.
-- Existing users remain 0 (no backfill). New Staff are set to 1 only at create time.

ALTER TABLE users
ADD COLUMN initial_device_auto_approval_eligible INTEGER NOT NULL DEFAULT 0;
