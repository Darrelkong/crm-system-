import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { knowledgeCategories } from "./knowledge-categories";

export const KNOWLEDGE_ARTICLE_STATUSES = [
  "draft",
  "published",
  "archived",
] as const;

export type KnowledgeArticleStatus =
  (typeof KNOWLEDGE_ARTICLE_STATUSES)[number];

export const KNOWLEDGE_ARTICLE_VISIBILITIES = [
  "team",
  "restricted",
  "owner",
] as const;

export type KnowledgeArticleVisibility =
  (typeof KNOWLEDGE_ARTICLE_VISIBILITIES)[number];

export const knowledgeArticles = sqliteTable(
  "knowledge_articles",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id")
      .notNull()
      .references(() => knowledgeCategories.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    summary: text("summary"),
    body: text("body").notNull(),
    status: text("status", { enum: KNOWLEDGE_ARTICLE_STATUSES })
      .notNull()
      .default("draft"),
    visibility: text("visibility", {
      enum: KNOWLEDGE_ARTICLE_VISIBILITIES,
    })
      .notNull()
      .default("team"),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    currentVersionNumber: integer("current_version_number")
      .notNull()
      .default(1),
    publishedVersionNumber: integer("published_version_number"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("idx_knowledge_articles_category_status").on(
      table.categoryId,
      table.status,
    ),
    index("idx_knowledge_articles_updated_at").on(table.updatedAt),
    check("knowledge_articles_title_not_blank", sql`length(trim(${table.title})) > 0`),
    check("knowledge_articles_body_not_blank", sql`length(trim(${table.body})) > 0`),
    check(
      "knowledge_articles_status_allowed",
      sql`${table.status} IN ('draft', 'published', 'archived')`,
    ),
    check(
      "knowledge_articles_visibility_allowed",
      sql`${table.visibility} IN ('team', 'restricted', 'owner')`,
    ),
    check(
      "knowledge_articles_version_positive",
      sql`${table.currentVersionNumber} >= 1`,
    ),
    check(
      "knowledge_articles_owner_visibility_requires_owner",
      sql`${table.visibility} <> 'owner' OR ${table.ownerUserId} IS NOT NULL`,
    ),
    check(
      "knowledge_articles_archived_state_consistent",
      sql`${table.status} <> 'archived' OR ${table.archivedAt} IS NOT NULL`,
    ),
  ],
);

export type KnowledgeArticle = typeof knowledgeArticles.$inferSelect;
export type NewKnowledgeArticle = typeof knowledgeArticles.$inferInsert;
