import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const BACKUP_JOB_STATUSES = ["running", "completed", "failed"] as const;
export type BackupJobStatus = (typeof BACKUP_JOB_STATUSES)[number];

export const BACKUP_TYPES = ["manual", "scheduled"] as const;
export type BackupType = (typeof BACKUP_TYPES)[number];

export const STORAGE_PROVIDERS = ["r2", "local", "none"] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export const backupJobs = sqliteTable(
  "backup_jobs",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull().$type<BackupJobStatus>(),
    backupType: text("backup_type").notNull().$type<BackupType>(),
    triggeredBy: text("triggered_by").references(() => users.id),
    fileName: text("file_name"),
    storageProvider: text("storage_provider").$type<StorageProvider>(),
    storageKey: text("storage_key"),
    tableCount: integer("table_count").notNull().default(0),
    recordCount: integer("record_count").notNull().default(0),
    fileSizeBytes: integer("file_size_bytes").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_backup_jobs_status").on(table.status),
    index("idx_backup_jobs_backup_type").on(table.backupType),
    index("idx_backup_jobs_created_at").on(table.createdAt),
    index("idx_backup_jobs_triggered_by").on(table.triggeredBy),
  ],
);

export type BackupJob = typeof backupJobs.$inferSelect;
export type NewBackupJob = typeof backupJobs.$inferInsert;
