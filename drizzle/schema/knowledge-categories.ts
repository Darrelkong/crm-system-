import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const knowledgeCategories = sqliteTable(
  "knowledge_categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    slug: text("slug").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_knowledge_categories_slug").on(table.slug),
    index("idx_knowledge_categories_active_order").on(
      table.isActive,
      table.sortOrder,
    ),
    check("knowledge_categories_name_not_blank", sql`length(trim(${table.name})) > 0`),
    check("knowledge_categories_slug_not_blank", sql`length(trim(${table.slug})) > 0`),
    check("knowledge_categories_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export type KnowledgeCategory = typeof knowledgeCategories.$inferSelect;
export type NewKnowledgeCategory = typeof knowledgeCategories.$inferInsert;
