import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { knowledgeCategories } from "./knowledge-categories";
import { users } from "./users";

/**
 * Default CRM business → Knowledge library category mapping (Priority 1).
 * V1: at most one row per requested_project_code (see unique index).
 * Future gates may add more specific category selection per topic/candidate
 * without replacing this default mapping contract.
 */
export const knowledgeBusinessCategoryMappings = sqliteTable(
  "knowledge_business_category_mappings",
  {
    id: text("id").primaryKey(),
    requestedProjectCode: text("requested_project_code").notNull(),
    knowledgeCategoryId: text("knowledge_category_id")
      .notNull()
      .references(() => knowledgeCategories.id, { onDelete: "restrict" }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_knowledge_business_category_mappings_code").on(
      table.requestedProjectCode,
    ),
    index("idx_knowledge_business_category_mappings_category").on(
      table.knowledgeCategoryId,
    ),
    check(
      "knowledge_business_category_mappings_code_not_blank",
      sql`length(trim(${table.requestedProjectCode})) > 0`,
    ),
  ],
);

export type KnowledgeBusinessCategoryMapping =
  typeof knowledgeBusinessCategoryMappings.$inferSelect;
export type NewKnowledgeBusinessCategoryMapping =
  typeof knowledgeBusinessCategoryMappings.$inferInsert;
