import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { mailOutboundRevisions } from "./mail-outbound-revisions";
import { MAIL_RECIPIENT_TYPES } from "./mail-message-recipients";

/**
 * Immutable recipient snapshot per outbound revision.
 *
 * Do NOT read live draft recipients after revision creation.
 * Submit minimum: >=1 unique recipient across To+Cc+Bcc (NOT To-specific) — service layer.
 * Max 50 unique recipients: service layer only.
 * Future materialization: revision recipients -> mail_message_recipients exactly.
 */
export const mailOutboundRevisionRecipients = sqliteTable(
  "mail_outbound_revision_recipients",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => mailOutboundRevisions.id),
    recipientType: text("recipient_type", {
      enum: MAIL_RECIPIENT_TYPES,
    }).notNull(),
    address: text("address").notNull(),
    displayName: text("display_name"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_mail_outbound_revision_recipients_revision_id").on(
      table.revisionId,
    ),
    uniqueIndex("uq_mail_outbound_revision_recipients_revision_address").on(
      table.revisionId,
      sql`lower(${table.address})`,
    ),
    uniqueIndex("uq_mail_outbound_revision_recipients_id_revision_id").on(
      table.id,
      table.revisionId,
    ),
  ],
);

export type MailOutboundRevisionRecipient =
  typeof mailOutboundRevisionRecipients.$inferSelect;
export type NewMailOutboundRevisionRecipient =
  typeof mailOutboundRevisionRecipients.$inferInsert;
