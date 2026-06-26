import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const customerTags = sqliteTable(
  "customer_tags",
  {
    id: text("id").primaryKey(),
    tagKey: text("tag_key").notNull().unique(),
    label: text("label").notNull(),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_customer_tags_is_active").on(table.isActive)],
);

export type CustomerTag = typeof customerTags.$inferSelect;
export type NewCustomerTag = typeof customerTags.$inferInsert;
