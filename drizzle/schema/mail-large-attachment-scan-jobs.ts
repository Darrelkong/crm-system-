import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { mailLargeAttachmentLifecycle } from "./mail-large-attachment-lifecycle";
import { mailStoredFiles } from "./mail-stored-files";

export const MAIL_LARGE_ATTACHMENT_SCAN_JOB_STATUSES = [
  "queued",
  "submitted",
  "polling",
  "retry_wait",
  "completed",
  "failed",
  "cancelled",
] as const;

export type MailLargeAttachmentScanJobStatus =
  (typeof MAIL_LARGE_ATTACHMENT_SCAN_JOB_STATUSES)[number];

/**
 * Durable processing state for the private malware scan pipeline.
 *
 * security_scan_status on mail_stored_files remains the canonical file/send status.
 * This table only records asynchronous provider work and normalized evidence.
 */
export const mailLargeAttachmentScanJobs = sqliteTable(
  "mail_large_attachment_scan_jobs",
  {
    id: text("id").primaryKey(),
    lifecycleId: text("lifecycle_id")
      .notNull()
      .references(() => mailLargeAttachmentLifecycle.id, {
        onDelete: "cascade",
      }),
    storedFileId: text("stored_file_id")
      .notNull()
      .references(() => mailStoredFiles.id, {
        onDelete: "cascade",
      }),
    provider: text("provider").notNull(),
    providerJobId: text("provider_job_id"),
    jobStatus: text("job_status", {
      enum: MAIL_LARGE_ATTACHMENT_SCAN_JOB_STATUSES,
    }).notNull(),
    storageKey: text("storage_key").notNull(),
    storageEtag: text("storage_etag").notNull(),
    storageVersion: text("storage_version"),
    declaredContentHash: text("declared_content_hash").notNull(),
    providerContentHash: text("provider_content_hash"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: text("next_attempt_at"),
    submittedAt: text("submitted_at"),
    completedAt: text("completed_at"),
    lastErrorCode: text("last_error_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_mail_large_attachment_scan_jobs_lifecycle_id").on(
      table.lifecycleId,
    ),
    uniqueIndex("uq_mail_large_attachment_scan_jobs_provider_job").on(
      table.provider,
      table.providerJobId,
    ),
    index("idx_mail_large_attachment_scan_jobs_stored_file_id").on(
      table.storedFileId,
    ),
    index("idx_mail_large_attachment_scan_jobs_status_next_attempt").on(
      table.jobStatus,
      table.nextAttemptAt,
    ),
    index("idx_mail_large_attachment_scan_jobs_provider_job_id").on(
      table.providerJobId,
    ),
  ],
);

export type MailLargeAttachmentScanJob =
  typeof mailLargeAttachmentScanJobs.$inferSelect;
export type NewMailLargeAttachmentScanJob =
  typeof mailLargeAttachmentScanJobs.$inferInsert;
