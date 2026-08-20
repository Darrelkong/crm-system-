import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";
import { mailMessages } from "./mail-messages";

/**
 * Per-user read state + personal Important (not global).
 *
 * No row => unread and not personally important (recommended default).
 * Mark unread sets is_read=0, read_at=NULL without deleting the row.
 * SQL CHECK: (is_read=1 AND read_at NOT NULL) OR (is_read=0 AND read_at IS NULL).
 * Important is unchanged when read state toggles.
 */
export const mailMessageReadStates = sqliteTable(
  "mail_message_read_states",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => mailMessages.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    isRead: integer("is_read").notNull().default(0),
    readAt: text("read_at"),
    isImportantPersonal: integer("is_important_personal").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId] }),
    index("idx_mail_message_read_states_user_read").on(
      table.userId,
      table.isRead,
    ),
  ],
);

export type MailMessageReadState = typeof mailMessageReadStates.$inferSelect;
export type NewMailMessageReadState = typeof mailMessageReadStates.$inferInsert;
