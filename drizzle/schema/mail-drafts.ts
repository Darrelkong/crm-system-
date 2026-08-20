import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";
import { customers } from "./customers";
import { mailMailboxes } from "./mail-mailboxes";
import { mailSenderIdentities } from "./mail-sender-identities";
import { mailMessages } from "./mail-messages";
import {
  MAIL_COMPOSE_MODES,
  MAIL_MESSAGE_SENSITIVITIES,
} from "./mail-messages";

export { MAIL_COMPOSE_MODES, type MailComposeMode } from "./mail-messages";

export const MAIL_CUSTOMER_ASSOCIATION_TYPES = [
  "auto_match",
  "manual",
] as const;
export type MailCustomerAssociationType =
  (typeof MAIL_CUSTOMER_ASSOCIATION_TYPES)[number];

/**
 * Mutable server-persisted compose working state.
 *
 * NOT canonical send/approval content. Blank ephemeral compose never creates a row
 * (no is_blank column — service decides meaningful content before persistence).
 *
 * body_html is WORKING COPY — client editor HTML; NOT trusted/sanitized.
 * Server sanitizes when creating mail_outbound_revisions.
 *
 * Draft may be incomplete: nullable mailbox, sender identity, recipients, subject.
 * CRM customer association: FK does not imply authorization — service validates via
 * src/lib/permissions/customers.ts. Shared mailbox membership grants zero CRM access.
 *
 * Customer association CHECK (SQL): when customer_id is set, type + associated_at required;
 * customer_association_type IS NOT NULL explicit (NULL IN (...) is not a rejection in SQLite).
 * customer_associated_by_user_id MAY be NULL (ON DELETE SET NULL or system auto-match).
 */
export const mailDrafts = sqliteTable(
  "mail_drafts",
  {
    id: text("id").primaryKey(),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => users.id),
    mailboxId: text("mailbox_id").references(() => mailMailboxes.id),
    senderIdentityId: text("sender_identity_id").references(
      () => mailSenderIdentities.id,
    ),
    subject: text("subject").notNull().default(""),
    bodyText: text("body_text").notNull().default(""),
    bodyHtml: text("body_html"),
    sensitivity: text("sensitivity", { enum: MAIL_MESSAGE_SENSITIVITIES })
      .notNull()
      .default("normal"),
    composeMode: text("compose_mode", { enum: MAIL_COMPOSE_MODES }).notNull(),
    replyToMessageId: text("reply_to_message_id").references(
      () => mailMessages.id,
    ),
    autosaveVersion: integer("autosave_version").notNull().default(0),
    lastSavedAt: text("last_saved_at").notNull(),
    discardedAt: text("discarded_at"),
    customerId: text("customer_id").references(() => customers.id),
    customerAssociationType: text("customer_association_type", {
      enum: MAIL_CUSTOMER_ASSOCIATION_TYPES,
    }),
    customerAssociatedByUserId: text("customer_associated_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    customerAssociatedAt: text("customer_associated_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_mail_drafts_author_discarded_updated").on(
      table.authorUserId,
      table.discardedAt,
      table.updatedAt,
    ),
    index("idx_mail_drafts_mailbox_id").on(table.mailboxId),
  ],
);

export type MailDraft = typeof mailDrafts.$inferSelect;
export type NewMailDraft = typeof mailDrafts.$inferInsert;
