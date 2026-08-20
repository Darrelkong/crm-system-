import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { mailOutboundRevisions } from "./mail-outbound-revisions";
import { mailStoredFiles } from "./mail-stored-files";
import { MAIL_DELIVERY_MODES } from "./mail-draft-attachments";

/**
 * Immutable canonical attachment snapshot for one Outbound Revision.
 *
 * Materialized at revision creation — do NOT read mutable draft attachments
 * at approval/send time after revision exists.
 *
 * content_hash MUST match stored file bytes (composite FK to mail_stored_files).
 * No updated_at. No approval/send/delivery state.
 *
 * Canonical hash inputs (documented; service NOT implemented):
 *   content_hash, display_filename, mime_type, size_bytes, sort_order,
 *   delivery_mode, secure_expiry_days
 * EXCLUDED: stored_file_id, attachment row id, storage keys, scan state.
 * original_filename is historical — NOT hash input when only display_filename is emitted.
 *
 * UNIQUE (id, stored_file_id, content_hash) supports message attachment lineage FK.
 */
export const mailOutboundRevisionAttachments = sqliteTable(
  "mail_outbound_revision_attachments",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => mailOutboundRevisions.id),
    storedFileId: text("stored_file_id").notNull(),
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
      name: "fk_mail_outbound_revision_attachments_stored_file_hash",
      columns: [table.storedFileId, table.contentHash],
      foreignColumns: [mailStoredFiles.id, mailStoredFiles.contentHash],
    }),
    index("idx_mail_outbound_revision_attachments_revision_id").on(
      table.revisionId,
    ),
    index("idx_mail_outbound_revision_attachments_stored_file_id").on(
      table.storedFileId,
    ),
    uniqueIndex("uq_mail_outbound_revision_attachments_id_file_hash").on(
      table.id,
      table.storedFileId,
      table.contentHash,
    ),
  ],
);

export type MailOutboundRevisionAttachment =
  typeof mailOutboundRevisionAttachments.$inferSelect;
export type NewMailOutboundRevisionAttachment =
  typeof mailOutboundRevisionAttachments.$inferInsert;
