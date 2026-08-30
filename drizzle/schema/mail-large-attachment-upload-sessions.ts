import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./users";
import { mailDrafts } from "./mail-drafts";
import { mailMailboxes } from "./mail-mailboxes";
import { mailStoredFiles } from "./mail-stored-files";

/**
 * Persistent Large Attachment upload authorization session.
 *
 * Authorize → browser PUT → finalize crosses separate Worker requests.
 * MUST NOT rely on ephemeral Worker memory.
 *
 * Do NOT persist: presigned PUT URL, signing secrets, R2 credentials.
 *
 * declared_content_hash: client-computed SHA-256 fingerprint at authorize time.
 * NOT server-verified SHA-256 unless Phase 2B R2 checksum proof establishes equivalence.
 */
export const mailLargeAttachmentUploadSessions = sqliteTable(
  "mail_large_attachment_upload_sessions",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id),
    draftId: text("draft_id")
      .notNull()
      .references(() => mailDrafts.id),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailMailboxes.id),
    storedFileId: text("stored_file_id").references(() => mailStoredFiles.id),
    storageKey: text("storage_key").notNull(),
    expectedFilename: text("expected_filename").notNull(),
    expectedMimeType: text("expected_mime_type").notNull(),
    expectedSizeBytes: integer("expected_size_bytes").notNull(),
    maxSizeBytes: integer("max_size_bytes").notNull(),
    declaredContentHash: text("declared_content_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    finalizedAt: text("finalized_at"),
    invalidatedAt: text("invalidated_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_mail_large_attachment_upload_sessions_storage_key").on(
      table.storageKey,
    ),
    index("idx_mail_large_attachment_upload_sessions_draft_id").on(table.draftId),
    index("idx_mail_large_attachment_upload_sessions_actor_draft").on(
      table.actorUserId,
      table.draftId,
    ),
    index("idx_mail_large_attachment_upload_sessions_expires_at").on(
      table.expiresAt,
    ),
  ],
);

export type MailLargeAttachmentUploadSession =
  typeof mailLargeAttachmentUploadSessions.$inferSelect;
export type NewMailLargeAttachmentUploadSession =
  typeof mailLargeAttachmentUploadSessions.$inferInsert;
