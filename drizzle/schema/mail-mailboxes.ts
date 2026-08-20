import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const MAIL_MAILBOX_TYPES = ["personal", "shared"] as const;
export type MailMailboxType = (typeof MAIL_MAILBOX_TYPES)[number];

export const MAIL_MAILBOX_STATUSES = [
  "active",
  "suspended",
  "archived",
  "deleted",
] as const;
export type MailMailboxStatus = (typeof MAIL_MAILBOX_STATUSES)[number];

export const mailMailboxes = sqliteTable(
  "mail_mailboxes",
  {
    id: text("id").primaryKey(),
    /** Service layer lowercases; DB enforces lifetime case-insensitive uniqueness. */
    address: text("address").notNull(),
    displayName: text("display_name"),
    mailboxType: text("mailbox_type", { enum: MAIL_MAILBOX_TYPES }).notNull(),
    status: text("status", { enum: MAIL_MAILBOX_STATUSES })
      .notNull()
      .default("active"),
    deletedAt: text("deleted_at"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_mail_mailboxes_status").on(table.status),
    index("idx_mail_mailboxes_type").on(table.mailboxType),
    uniqueIndex("uq_mail_mailboxes_address").on(sql`lower(${table.address})`),
  ],
);

export type MailMailbox = typeof mailMailboxes.$inferSelect;
export type NewMailMailbox = typeof mailMailboxes.$inferInsert;
