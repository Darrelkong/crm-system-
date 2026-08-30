import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { mailDrafts } from "./mail-drafts";
import { mailStoredFiles } from "./mail-stored-files";

export const MAIL_DELIVERY_MODES = [
  "direct_attachment",
  "secure_file",
  "large_attachment",
] as const;

/** Delivery modes frozen in migration 0055 — used when testing legacy SQL only. */
export const MAIL_DELIVERY_MODES_FROZEN_0055 = [
  "direct_attachment",
  "secure_file",
] as const;
export type MailDeliveryMode = (typeof MAIL_DELIVERY_MODES)[number];

/** Secure File expiry policy options (days). Default 7 at service/UI layer. */
export const MAIL_SECURE_EXPIRY_DAYS = [1, 3, 7] as const;
export type MailSecureExpiryDays = (typeof MAIL_SECURE_EXPIRY_DAYS)[number];

/**
 * Mutable working attachment usage on a Draft.
 *
 * display_filename: user-visible rename — original_filename stays on mail_stored_files.
 *
 * delivery_mode CHECK (SQL): direct_attachment | large_attachment → secure_expiry_days NULL;
 * secure_file → secure_expiry_days IS NOT NULL AND IN (1, 3, 7).
 * Explicit IS NOT NULL on secure branch (SQLite NULL IN semantics).
 *
 * Mutable during compose. NOT canonical — revision snapshot is authoritative after submit.
 * No per-parent stored_file_id uniqueness — same file may attach twice if intended.
 */
export const mailDraftAttachments = sqliteTable(
  "mail_draft_attachments",
  {
    id: text("id").primaryKey(),
    draftId: text("draft_id")
      .notNull()
      .references(() => mailDrafts.id),
    storedFileId: text("stored_file_id")
      .notNull()
      .references(() => mailStoredFiles.id),
    displayFilename: text("display_filename").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    deliveryMode: text("delivery_mode", { enum: MAIL_DELIVERY_MODES }).notNull(),
    secureExpiryDays: integer("secure_expiry_days"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_mail_draft_attachments_draft_id").on(table.draftId),
  ],
);

export type MailDraftAttachment = typeof mailDraftAttachments.$inferSelect;
export type NewMailDraftAttachment = typeof mailDraftAttachments.$inferInsert;
