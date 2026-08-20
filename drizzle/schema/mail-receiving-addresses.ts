import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { mailMailboxes } from "./mail-mailboxes";

export const MAIL_RECEIVING_ADDRESS_TYPES = ["primary", "alias"] as const;
export type MailReceivingAddressType =
  (typeof MAIL_RECEIVING_ADDRESS_TYPES)[number];

export const MAIL_RECEIVING_ADDRESS_STATUSES = [
  "active",
  "suspended",
  "retired",
] as const;
export type MailReceivingAddressStatus =
  (typeof MAIL_RECEIVING_ADDRESS_STATUSES)[number];

/**
 * Inbound receiving address routing registry — one row = one lifetime-reserved
 * routable company address → exactly one Mailbox.
 *
 * Mailbox != Sender Identity. Receiving Address != Sender Identity.
 * The same normalized address MAY also exist on mail_sender_identities for outbound From.
 * Do NOT use sender_identity.alias_of_identity_id for inbound routing.
 *
 * address_type primary: inbound routing representation of mail_mailboxes.address.
 *   CURRENT PRIMARY: address_type = primary AND status IN (active, suspended).
 *   HISTORICAL PRIMARY: address_type = primary AND status = retired.
 *   At most one current Primary per mailbox; retired historical Primaries may coexist.
 *   Future service invariant (no triggers): current primary address MUST match
 *   mail_mailboxes.address under trim + Unicode NFC + lowercase.
 *
 * Primary address mutation (future service — do NOT overwrite old Primary row):
 *   A. Retire old current Primary. B. Preserve as historical Primary.
 *   C. Create new current Primary. D. Update mail_mailboxes.address atomically.
 *   Exact D1 batch contract designed before address-management service implementation.
 * address_type alias: additional inbound route into the same mailbox (unaffected).
 *
 * Stored address canonical form (SQL CHECK): nonblank and address = TRIM(address).
 * Unicode NFC remains service-layer normalization before lookup.
 *
 * Lifetime case-insensitive trimmed uniqueness on lower(trim(address)) — includes retired rows.
 * Archived mailbox routes remain owned by the original mailbox; effective inbound
 * fallback (e.g. supervisor handling) is service policy, not route reassignment.
 *
 * Address normalization before lookup (service layer): trim, Unicode NFC, lowercase.
 * No provider-specific transformations (Gmail dots, plus stripping, alias guessing).
 */
export const mailReceivingAddresses = sqliteTable(
  "mail_receiving_addresses",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailMailboxes.id),
    /** Stored as TRIM(address); service layer applies NFC + lowercase before lookup. */
    address: text("address").notNull(),
    addressType: text("address_type", {
      enum: MAIL_RECEIVING_ADDRESS_TYPES,
    }).notNull(),
    status: text("status", { enum: MAIL_RECEIVING_ADDRESS_STATUSES })
      .notNull()
      .default("active"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    retiredAt: text("retired_at"),
  },
  (table) => [
    uniqueIndex("uq_mail_receiving_addresses_address").on(
      sql`lower(trim(${table.address}))`,
    ),
    uniqueIndex("uq_mail_receiving_addresses_primary_per_mailbox")
      .on(table.mailboxId)
      .where(
        sql`${table.addressType} = 'primary' AND ${table.status} IN ('active', 'suspended')`,
      ),
    index("idx_mail_receiving_addresses_mailbox_id").on(table.mailboxId),
    index("idx_mail_receiving_addresses_status").on(table.status),
  ],
);

export type MailReceivingAddress = typeof mailReceivingAddresses.$inferSelect;
export type NewMailReceivingAddress = typeof mailReceivingAddresses.$inferInsert;
