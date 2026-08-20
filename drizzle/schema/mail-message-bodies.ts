import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { mailMessages } from "./mail-messages";

/**
 * 1:1 body payload kept off the narrow message list row.
 *
 * body_html_sanitized / quoted_html_sanitized: server-sanitized HTML ONLY.
 * Inbound: sanitize at ingress before persistence.
 * Outbound: materialize from immutable outbound revision.
 * Raw MIME / R2 retention deferred.
 */
export const mailMessageBodies = sqliteTable("mail_message_bodies", {
  messageId: text("message_id")
    .primaryKey()
    .references(() => mailMessages.id),
  bodyText: text("body_text").notNull().default(""),
  bodyHtmlSanitized: text("body_html_sanitized"),
  quotedText: text("quoted_text"),
  quotedHtmlSanitized: text("quoted_html_sanitized"),
  sanitizationVersion: text("sanitization_version").notNull().default("1"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type MailMessageBody = typeof mailMessageBodies.$inferSelect;
export type NewMailMessageBody = typeof mailMessageBodies.$inferInsert;
