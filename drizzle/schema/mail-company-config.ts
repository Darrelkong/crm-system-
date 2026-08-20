import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";
import { mailMailboxes } from "./mail-mailboxes";

/** Frozen singleton key — exactly one company Mail config row. */
export const MAIL_COMPANY_CONFIG_SINGLETON_ID = "default" as const;

/**
 * Singleton company Mail configuration.
 *
 * Zero rows = inbound fallback not configured (allowed after migration).
 * When configured, inbound_fallback_mailbox_id references an active shared
 * mailbox validated at set time by service layer.
 *
 * Used when known receiving routes whose route-owner mailbox is archived or
 * deleted require fallback delivery (service policy — see inbound-routing-policy).
 *
 * No ON DELETE CASCADE on mailbox FK.
 */
export const mailCompanyConfig = sqliteTable(
  "mail_company_config",
  {
    id: text("id").primaryKey(),
    inboundFallbackMailboxId: text("inbound_fallback_mailbox_id")
      .notNull()
      .references(() => mailMailboxes.id),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: text("updated_at").notNull(),
  },
);

export type MailCompanyConfig = typeof mailCompanyConfig.$inferSelect;
export type NewMailCompanyConfig = typeof mailCompanyConfig.$inferInsert;
