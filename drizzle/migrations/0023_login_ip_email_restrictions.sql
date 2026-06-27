CREATE TABLE `login_ip_email_restrictions` (
  `ip_address` text PRIMARY KEY NOT NULL,
  `failed_email_attempts` integer NOT NULL DEFAULT 0,
  `penalty_level` integer NOT NULL DEFAULT 0,
  `restricted_until` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE INDEX `idx_login_ip_email_restrictions_restricted_until` ON `login_ip_email_restrictions` (`restricted_until`);
