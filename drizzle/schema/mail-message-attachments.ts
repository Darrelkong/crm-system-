import { foreignKey, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { mailMessages } from "./mail-messages";
import { mailStoredFiles } from "./mail-stored-files";
import { mailOutboundRevisionAttachments } from "./mail-outbound-revision-attachments";
import { MAIL_DELIVERY_MODES } from "./mail-draft-attachments";

/**
 * Message attachment — inbound direct attachments and outbound materialized attachments.
 *
 * Inbound: source_revision_attachment_id = NULL.
 * Outbound: materialized from revision attachment — copy frozen metadata exactly.
 * Composite FK (source_revision_attachment_id, stored_file_id, content_hash) prevents
 * referencing a revision attachment with mismatched file identity.
 * Future service MUST ensure revision attachment belongs to the send revision
 * (cross-domain invariant — future Send Operation schema).
 *
 * secure_file preserves delivery_mode + secure_expiry_days at send time.
 * Token / URL / download session / access logs: later Secure File implementation.
 *
 * Composite FK (stored_file_id, content_hash) prevents hash/file identity mismatch.
 */
export const mailMessageAttachments = sqliteTable(
  "mail_message_attachments",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => mailMessages.id),
    storedFileId: text("stored_file_id").notNull(),
    sourceRevisionAttachmentId: text("source_revision_attachment_id"),
    contentHash: text("content_hash").notNull(),
    originalFilename: text("original_filename").notNull(),
    displayFilename: text("display_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    deliveryMode: text("delivery_mode", { enum: MAIL_DELIVERY_MODES }).notNull(),
    secureExpiryDays: integer("secure_expiry_days"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_message_attachments_stored_file_hash",
      columns: [table.storedFileId, table.contentHash],
      foreignColumns: [mailStoredFiles.id, mailStoredFiles.contentHash],
    }),
    foreignKey({
      name: "fk_mail_message_attachments_source_revision_lineage",
      columns: [
        table.sourceRevisionAttachmentId,
        table.storedFileId,
        table.contentHash,
      ],
      foreignColumns: [
        mailOutboundRevisionAttachments.id,
        mailOutboundRevisionAttachments.storedFileId,
        mailOutboundRevisionAttachments.contentHash,
      ],
    }),
    index("idx_mail_message_attachments_message_id").on(table.messageId),
    index("idx_mail_message_attachments_stored_file_id").on(table.storedFileId),
    index("idx_mail_message_attachments_source_revision_attachment").on(
      table.sourceRevisionAttachmentId,
    ),
  ],
);

export type MailMessageAttachment = typeof mailMessageAttachments.$inferSelect;
export type NewMailMessageAttachment = typeof mailMessageAttachments.$inferInsert;
