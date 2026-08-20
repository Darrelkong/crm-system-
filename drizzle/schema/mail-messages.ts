import {
  foreignKey,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { mailMailboxes } from "./mail-mailboxes";
import { mailSenderIdentities } from "./mail-sender-identities";
import { mailThreads } from "./mail-threads";

export const MAIL_MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MailMessageDirection = (typeof MAIL_MESSAGE_DIRECTIONS)[number];

export const MAIL_MESSAGE_SENSITIVITIES = [
  "normal",
  "sensitive",
  "restricted",
] as const;
export type MailMessageSensitivity = (typeof MAIL_MESSAGE_SENSITIVITIES)[number];

export const MAIL_COMPOSE_MODES = [
  "new",
  "reply",
  "reply_all",
  "forward",
] as const;
export type MailComposeMode = (typeof MAIL_COMPOSE_MODES)[number];

/**
 * Canonical persisted message. NOT draft / approval / transport state.
 * No lifecycle_state — trash via trashed_at; delivery via future tables.
 *
 * from_address / from_display_name are historical header snapshots.
 *
 * Direction coupling (SQL CHECK):
 *   inbound  → sender_identity_id IS NULL, compose_mode IS NULL, received_at required
 *   outbound → sender_identity_id IS NOT NULL, compose_mode IS NOT NULL
 *              AND compose_mode IN (new|reply|reply_all|forward)
 *
 * SQLite NULL semantics: CHECK passes when expression is NULL — outbound requires
 * explicit compose_mode IS NOT NULL; do not rely on IN (...) alone.
 *
 * sender_identity_id FK uses ON DELETE SET NULL for historical safety; hard-deleting an
 * identity referenced by outbound messages is blocked when SET NULL would violate CHECK.
 *
 * reply_to_message_id same-thread parent is a service-layer invariant when enforced.
 */
export const mailMessages = sqliteTable(
  "mail_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailMailboxes.id),
    direction: text("direction", { enum: MAIL_MESSAGE_DIRECTIONS }).notNull(),
    senderIdentityId: text("sender_identity_id").references(
      () => mailSenderIdentities.id,
      { onDelete: "set null" },
    ),
    fromAddress: text("from_address").notNull(),
    fromDisplayName: text("from_display_name"),
    subject: text("subject").notNull(),
    subjectNormalized: text("subject_normalized"),
    previewText: text("preview_text").notNull().default(""),
    sensitivity: text("sensitivity", { enum: MAIL_MESSAGE_SENSITIVITIES })
      .notNull()
      .default("normal"),
    internetMessageId: text("internet_message_id"),
    inReplyTo: text("in_reply_to"),
    referencesHeader: text("references_header"),
    replyToMessageId: text("reply_to_message_id").references(
      (): AnySQLiteColumn => mailMessages.id,
    ),
    composeMode: text("compose_mode", { enum: MAIL_COMPOSE_MODES }),
    receivedAt: text("received_at"),
    sentAt: text("sent_at"),
    trashedAt: text("trashed_at"),
    trashedBy: text("trashed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_messages_thread_mailbox",
      columns: [table.threadId, table.mailboxId],
      foreignColumns: [mailThreads.id, mailThreads.mailboxId],
    }),
    index("idx_mail_messages_mailbox_direction_received").on(
      table.mailboxId,
      table.direction,
      table.receivedAt,
    ),
    index("idx_mail_messages_mailbox_direction_sent").on(
      table.mailboxId,
      table.direction,
      table.sentAt,
    ),
    index("idx_mail_messages_thread_created").on(
      table.threadId,
      table.createdAt,
    ),
    index("idx_mail_messages_mailbox_not_trashed")
      .on(table.mailboxId, table.createdAt)
      .where(sql`${table.trashedAt} IS NULL`),
    uniqueIndex("uq_mail_messages_inbound_internet_message_id")
      .on(table.mailboxId, table.internetMessageId)
      .where(
        sql`${table.internetMessageId} IS NOT NULL AND ${table.direction} = 'inbound'`,
      ),
    uniqueIndex("uq_mail_messages_outbound_internet_message_id")
      .on(table.internetMessageId)
      .where(
        sql`${table.internetMessageId} IS NOT NULL AND ${table.direction} = 'outbound'`,
      ),
    uniqueIndex("uq_mail_messages_id_internet_message_id_direction").on(
      table.id,
      table.internetMessageId,
      table.direction,
    ),
  ],
);

export type MailMessage = typeof mailMessages.$inferSelect;
export type NewMailMessage = typeof mailMessages.$inferInsert;
