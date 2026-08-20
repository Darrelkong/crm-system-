import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { mailDrafts } from "./mail-drafts";
import { MAIL_RECIPIENT_TYPES } from "./mail-message-recipients";

export { MAIL_RECIPIENT_TYPES, type MailRecipientType } from "./mail-message-recipients";

/**
 * Mutable To/Cc/Bcc working recipients for a draft.
 *
 * One normalized address per draft across ALL types (case-insensitive).
 * Submit minimum: >=1 unique recipient across To+Cc+Bcc (NOT To-specific) — service layer.
 * Max 50 unique recipients: service layer only.
 */
export const mailDraftRecipients = sqliteTable(
  "mail_draft_recipients",
  {
    id: text("id").primaryKey(),
    draftId: text("draft_id")
      .notNull()
      .references(() => mailDrafts.id),
    recipientType: text("recipient_type", {
      enum: MAIL_RECIPIENT_TYPES,
    }).notNull(),
    address: text("address").notNull(),
    displayName: text("display_name"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_mail_draft_recipients_draft_id").on(table.draftId),
    uniqueIndex("uq_mail_draft_recipients_draft_address").on(
      table.draftId,
      sql`lower(${table.address})`,
    ),
  ],
);

export type MailDraftRecipient = typeof mailDraftRecipients.$inferSelect;
export type NewMailDraftRecipient = typeof mailDraftRecipients.$inferInsert;
