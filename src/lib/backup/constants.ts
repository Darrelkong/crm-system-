/** Backup JSON format version. */
export const BACKUP_VERSION = "1.0";

/**
 * Business tables included in backups.
 * sessions are intentionally excluded (contain token_hash).
 */
export const BACKUP_TABLE_NAMES = [
  "users",
  "customers",
  "customer_contacts",
  "customer_assignees",
  "customer_tags",
  "customer_ai_insights",
  "follow_ups",
  "tasks",
  "audit_logs",
  "login_logs",
  "login_ip_email_restrictions",
  "system_settings",
  "approvals",
  "notifications",
  "announcements",
  "import_jobs",
  "export_jobs",
  "field_change_logs",
  "reclamation_warning_logs",
  "customer_code_counter",
  "backup_jobs",
] as const;

export type BackupTableName = (typeof BACKUP_TABLE_NAMES)[number];

/**
 * Sensitive fields excluded from backup payloads.
 * - users.password_hash: never exported
 * - sessions table: not backed up at all
 */
export const BACKUP_EXCLUDED_FIELDS: Record<string, readonly string[]> = {
  users: ["password_hash"],
};

export const BACKUP_AUDIT_ACTIONS = {
  started: "backup.started",
  completed: "backup.completed",
  failed: "backup.failed",
} as const;
