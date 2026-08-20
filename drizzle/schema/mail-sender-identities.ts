import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { mailMailboxes } from "./mail-mailboxes";

export const MAIL_SENDER_IDENTITY_STATUSES = [
  "active",
  "suspended",
  "deleted",
] as const;
export type MailSenderIdentityStatus =
  (typeof MAIL_SENDER_IDENTITY_STATUSES)[number];

/**
 * Mailbox != Sender Identity.
 *
 * CHECK (SQL): default_mailbox_id IS NOT NULL OR sent_folder_mailbox_id IS NOT NULL
 *
 * When default_mailbox_id IS NULL, sent_folder_mailbox_id is required.
 * The actor must hold mailbox membership on sent_folder_mailbox_id with
 * appropriate can_reply / can_send. Identity grant alone does not bypass membership.
 */
export const mailSenderIdentities = sqliteTable(
  "mail_sender_identities",
  {
    id: text("id").primaryKey(),
    /** Service layer lowercases; DB enforces lifetime case-insensitive uniqueness. */
    address: text("address").notNull(),
    displayName: text("display_name"),
    status: text("status", { enum: MAIL_SENDER_IDENTITY_STATUSES })
      .notNull()
      .default("active"),
    defaultMailboxId: text("default_mailbox_id").references(
      () => mailMailboxes.id,
    ),
    sentFolderMailboxId: text("sent_folder_mailbox_id").references(
      () => mailMailboxes.id,
    ),
    aliasOfIdentityId: text("alias_of_identity_id").references(
      (): AnySQLiteColumn => mailSenderIdentities.id,
    ),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_mail_sender_identities_status").on(table.status),
    index("idx_mail_sender_identities_default_mailbox").on(
      table.defaultMailboxId,
    ),
    index("idx_mail_sender_identities_sent_folder_mailbox").on(
      table.sentFolderMailboxId,
    ),
    index("idx_mail_sender_identities_alias").on(table.aliasOfIdentityId),
    uniqueIndex("uq_mail_sender_identities_address").on(
      sql`lower(${table.address})`,
    ),
  ],
);

export type MailSenderIdentity = typeof mailSenderIdentities.$inferSelect;
export type NewMailSenderIdentity = typeof mailSenderIdentities.$inferInsert;
