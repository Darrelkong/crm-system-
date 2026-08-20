import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { mailMessages } from "./mail-messages";

export const MAIL_RECIPIENT_TYPES = ["to", "cc", "bcc"] as const;
export type MailRecipientType = (typeof MAIL_RECIPIENT_TYPES)[number];

/**
 * Normalized To/Cc/Bcc recipients.
 *
 * One normalized address per message across ALL types (case-insensitive).
 * Max 50 unique recipients: enforced in service layer only.
 *
 * SECURITY-CRITICAL: Bcc rows exist for audit but must not be exposed to every
 * Mail reader — future API authorization required.
 */
export const mailMessageRecipients = sqliteTable(
  "mail_message_recipients",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => mailMessages.id),
    recipientType: text("recipient_type", {
      enum: MAIL_RECIPIENT_TYPES,
    }).notNull(),
    address: text("address").notNull(),
    displayName: text("display_name"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_mail_message_recipients_message_id").on(table.messageId),
    uniqueIndex("uq_mail_message_recipients_message_address").on(
      table.messageId,
      sql`lower(${table.address})`,
    ),
  ],
);

export type MailMessageRecipient = typeof mailMessageRecipients.$inferSelect;
export type NewMailMessageRecipient = typeof mailMessageRecipients.$inferInsert;
