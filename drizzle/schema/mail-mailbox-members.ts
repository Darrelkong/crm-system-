import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { mailMailboxes } from "./mail-mailboxes";

/**
 * Mailbox workspace permissions.
 *
 * Future authorization (service layer, AND never OR):
 *   REPLY: can_reply here AND sender identity grant can_reply
 *   SEND:  can_send here AND sender identity grant can_send
 */
export const mailMailboxMembers = sqliteTable(
  "mail_mailbox_members",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailMailboxes.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    canRead: integer("can_read").notNull().default(0),
    canReply: integer("can_reply").notNull().default(0),
    canSend: integer("can_send").notNull().default(0),
    canAssign: integer("can_assign").notNull().default(0),
    canManageProcessing: integer("can_manage_processing").notNull().default(0),
    canAddInternalNote: integer("can_add_internal_note").notNull().default(0),
    grantedBy: text("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: text("revoked_at"),
    revokedBy: text("revoked_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_mail_mailbox_members_user_id").on(table.userId),
    index("idx_mail_mailbox_members_mailbox_id").on(table.mailboxId),
    uniqueIndex("uq_mail_mailbox_members_mailbox_user_active")
      .on(table.mailboxId, table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export type MailMailboxMember = typeof mailMailboxMembers.$inferSelect;
export type NewMailMailboxMember = typeof mailMailboxMembers.$inferInsert;
