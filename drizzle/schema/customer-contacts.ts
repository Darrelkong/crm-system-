import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { customers } from "./customers";

export const customerContacts = sqliteTable(
  "customer_contacts",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    wechatId: text("wechat_id"),
    email: text("email"),
    title: text("title"),
    isPrimary: integer("is_primary").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_customer_contacts_customer_id").on(table.customerId),
  ],
);

export type CustomerContact = typeof customerContacts.$inferSelect;
export type NewCustomerContact = typeof customerContacts.$inferInsert;
