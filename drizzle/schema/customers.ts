import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    customerName: text("customer_name").notNull(),
    phone: text("phone"),
    wechatId: text("wechat_id"),
    email: text("email"),
    source: text("source").notNull(),
    sourceRemark: text("source_remark"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    status: text("status", { enum: ["active", "inactive", "archived"] })
      .notNull()
      .default("active"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: text("updated_by").references(() => users.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_customers_owner_id").on(table.ownerId),
    index("idx_customers_created_at").on(table.createdAt),
    index("idx_customers_phone").on(table.phone),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
