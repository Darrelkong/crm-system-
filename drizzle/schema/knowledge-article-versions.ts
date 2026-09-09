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
import { knowledgeArticles } from "./knowledge-articles";
import { knowledgeCategories } from "./knowledge-categories";

export const knowledgeArticleVersions = sqliteTable(
  "knowledge_article_versions",
  {
    id: text("id").primaryKey(),
    articleId: text("article_id")
      .notNull()
      .references(() => knowledgeArticles.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    titleSnapshot: text("title_snapshot").notNull(),
    summarySnapshot: text("summary_snapshot"),
    bodySnapshot: text("body_snapshot").notNull(),
    categoryIdSnapshot: text("category_id_snapshot")
      .notNull()
      .references(() => knowledgeCategories.id, { onDelete: "restrict" }),
    visibilitySnapshot: text("visibility_snapshot").notNull(),
    ownerUserIdSnapshot: text("owner_user_id_snapshot").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    changeNote: text("change_note"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_knowledge_article_versions_article_number").on(
      table.articleId,
      table.versionNumber,
    ),
    index("idx_knowledge_article_versions_article_created").on(
      table.articleId,
      table.createdAt,
    ),
    check(
      "knowledge_article_versions_number_positive",
      sql`${table.versionNumber} >= 1`,
    ),
    check(
      "knowledge_article_versions_title_not_blank",
      sql`length(trim(${table.titleSnapshot})) > 0`,
    ),
    check(
      "knowledge_article_versions_body_not_blank",
      sql`length(trim(${table.bodySnapshot})) > 0`,
    ),
    check(
      "knowledge_article_versions_visibility_allowed",
      sql`${table.visibilitySnapshot} IN ('team', 'restricted', 'owner')`,
    ),
  ],
);

export type KnowledgeArticleVersion =
  typeof knowledgeArticleVersions.$inferSelect;
export type NewKnowledgeArticleVersion =
  typeof knowledgeArticleVersions.$inferInsert;
