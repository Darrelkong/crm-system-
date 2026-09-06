import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { mailDrafts } from "./mail-drafts";
import { mailLargeAttachmentLifecycle } from "./mail-large-attachment-lifecycle";
import { mailLargeAttachmentUploadSessions } from "./mail-large-attachment-upload-sessions";
import { mailMailboxes } from "./mail-mailboxes";
import { mailStoredFiles } from "./mail-stored-files";
import { users } from "./users";

/**
 * Server-side evidence that an authenticated uploader accepted the V1
 * large-attachment risk notice for one exact upload session.
 *
 * The upload-session identity is required at authorize time. Lifecycle and
 * stored-file identities are bound atomically during finalize.
 */
export const mailLargeAttachmentAcknowledgements = sqliteTable(
  "mail_large_attachment_acknowledgements",
  {
    id: text("id").primaryKey(),
    uploadSessionId: text("upload_session_id")
      .notNull()
      .references(() => mailLargeAttachmentUploadSessions.id, {
        onDelete: "cascade",
      }),
    lifecycleId: text("lifecycle_id").references(
      () => mailLargeAttachmentLifecycle.id,
      { onDelete: "cascade" },
    ),
    storedFileId: text("stored_file_id").references(() => mailStoredFiles.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    draftId: text("draft_id")
      .notNull()
      .references(() => mailDrafts.id),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailMailboxes.id),
    noticeVersion: text("notice_version").notNull(),
    acknowledgedAt: text("acknowledged_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_mail_large_attachment_ack_upload_session").on(
      table.uploadSessionId,
    ),
    index("idx_mail_large_attachment_ack_lifecycle").on(table.lifecycleId),
    index("idx_mail_large_attachment_ack_stored_file").on(table.storedFileId),
    index("idx_mail_large_attachment_ack_user").on(table.userId),
  ],
);

export type MailLargeAttachmentAcknowledgement =
  typeof mailLargeAttachmentAcknowledgements.$inferSelect;
export type NewMailLargeAttachmentAcknowledgement =
  typeof mailLargeAttachmentAcknowledgements.$inferInsert;
