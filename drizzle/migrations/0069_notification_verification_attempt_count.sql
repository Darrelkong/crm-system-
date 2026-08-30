-- Phase 4: notification email verification attempt tracking
-- ADDITIVE. Depends on mail_notification_identities (0052+).

ALTER TABLE mail_notification_identities
ADD COLUMN verification_attempt_count INTEGER NOT NULL DEFAULT 0;
