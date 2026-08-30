import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { mailStoredFiles } from "./mail-stored-files";

export const MAIL_LARGE_ATTACHMENT_LIFECYCLE_STATUSES = [
  "temporary",
  "approval_hold",
  "sent",
  "expired",
  "deleted",
  "revoked",
] as const;

export type MailLargeAttachmentLifecycleStatus =
  (typeof MAIL_LARGE_ATTACHMENT_LIFECYCLE_STATUSES)[number];

/**
 * Large Attachment lifecycle — one row per stored_file_id (V1).
 *
 * V1 does not reuse large-attachment blob identity across independent messages.
 * Immutable revision snapshots reference stored_file_id + content_hash separately.
 *
 * download_token_hash: SHA-256 lowercase hex of public bearer token — never store raw token.
 *
 * declared_content_hash / storage_version / storage_etag: see migration 0070 comments.
 * content_hash on mail_stored_files remains the logical fingerprint for revision binding;
 * storage ETag must never be silently reinterpreted as content_hash.
 */
export const mailLargeAttachmentLifecycle = sqliteTable(
  "mail_large_attachment_lifecycle",
  {
    id: text("id").primaryKey(),
    storedFileId: text("stored_file_id")
      .notNull()
      .references(() => mailStoredFiles.id),
    status: text("status", {
      enum: MAIL_LARGE_ATTACHMENT_LIFECYCLE_STATUSES,
    }).notNull(),
    uploadedAt: text("uploaded_at").notNull(),
    temporaryExpiresAt: text("temporary_expires_at"),
    approvalHoldStartedAt: text("approval_hold_started_at"),
    approvalAbsoluteExpiresAt: text("approval_absolute_expires_at"),
    sentAt: text("sent_at"),
    recipientExpiresAt: text("recipient_expires_at"),
    deletedAt: text("deleted_at"),
    deleteReason: text("delete_reason"),
    downloadTokenHash: text("download_token_hash"),
    downloadCount: integer("download_count").notNull().default(0),
    lastDownloadedAt: text("last_downloaded_at"),
    /** Client-declared SHA-256 fingerprint — not server-verified unless Phase 2B proves equivalence. */
    declaredContentHash: text("declared_content_hash"),
    /** Authoritative R2 object version at finalize — distinct from content_hash. */
    storageVersion: text("storage_version"),
    /** Authoritative R2 ETag at finalize — NOT equivalent to SHA-256 content_hash. */
    storageEtag: text("storage_etag"),
    finalizedAt: text("finalized_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_mail_large_attachment_lifecycle_stored_file_id").on(
      table.storedFileId,
    ),
    uniqueIndex("uq_mail_large_attachment_lifecycle_download_token_hash").on(
      table.downloadTokenHash,
    ),
    index("idx_mail_large_attachment_lifecycle_status_temporary_expires").on(
      table.status,
      table.temporaryExpiresAt,
    ),
    index("idx_mail_large_attachment_lifecycle_status_approval_absolute").on(
      table.status,
      table.approvalAbsoluteExpiresAt,
    ),
    index("idx_mail_large_attachment_lifecycle_status_recipient_expires").on(
      table.status,
      table.recipientExpiresAt,
    ),
  ],
);

export type MailLargeAttachmentLifecycle =
  typeof mailLargeAttachmentLifecycle.$inferSelect;
export type NewMailLargeAttachmentLifecycle =
  typeof mailLargeAttachmentLifecycle.$inferInsert;
