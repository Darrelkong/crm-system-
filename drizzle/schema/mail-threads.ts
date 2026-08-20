import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { mailMailboxes } from "./mail-mailboxes";

/**
 * V1: one internal thread belongs to exactly one mailbox.
 * Cross-mailbox RFC conversations produce separate threads.
 *
 * root_message_id omitted — derive first message by ordering thread messages.
 */
export const mailThreads = sqliteTable(
  "mail_threads",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailMailboxes.id),
    subjectNormalized: text("subject_normalized"),
    lastMessageAt: text("last_message_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_mail_threads_mailbox_last_message").on(
      table.mailboxId,
      table.lastMessageAt,
    ),
    uniqueIndex("uq_mail_threads_id_mailbox").on(table.id, table.mailboxId),
  ],
);

export type MailThread = typeof mailThreads.$inferSelect;
export type NewMailThread = typeof mailThreads.$inferInsert;
