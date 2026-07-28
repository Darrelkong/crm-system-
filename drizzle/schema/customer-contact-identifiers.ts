import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { customers } from "./customers";

export const CONTACT_IDENTIFIER_TYPES = [
  "phone",
  "wechat_id",
  "email",
] as const;

export type ContactIdentifierType = (typeof CONTACT_IDENTIFIER_TYPES)[number];

/**
 * D2 model: one row per customer × contact_type × normalized_value.
 * 0041: per-customer unique (customer_id, contact_type, normalized_value).
 * 0042: global unique (contact_type, normalized_value).
 */
export const customerContactIdentifiers = sqliteTable(
  "customer_contact_identifiers",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    contactType: text("contact_type", {
      enum: CONTACT_IDENTIFIER_TYPES,
    }).notNull(),
    normalizedValue: text("normalized_value").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_customer_contact_identifiers_customer_type_value").on(
      table.customerId,
      table.contactType,
      table.normalizedValue,
    ),
    uniqueIndex("uq_customer_contact_identifiers_type_value").on(
      table.contactType,
      table.normalizedValue,
    ),
    index("idx_customer_contact_identifiers_customer_id").on(table.customerId),
  ],
);

export type CustomerContactIdentifier =
  typeof customerContactIdentifiers.$inferSelect;
export type NewCustomerContactIdentifier =
  typeof customerContactIdentifiers.$inferInsert;
