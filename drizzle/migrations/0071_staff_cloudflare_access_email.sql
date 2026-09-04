-- Phase 18A: Staff-only Cloudflare Access Email binding
-- Additive migration. Existing users remain unchanged and unbound (NULL).

ALTER TABLE users ADD COLUMN cloudflare_access_email TEXT;

-- lower(NULL) remains NULL, so multiple unbound Staff rows are allowed while
-- normalized non-null Access Emails remain one-to-one across all users.
CREATE UNIQUE INDEX uq_users_cloudflare_access_email
  ON users (lower(cloudflare_access_email));
