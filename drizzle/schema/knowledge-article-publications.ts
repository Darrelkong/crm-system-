import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { knowledgeArticles } from "./knowledge-articles";
import { knowledgeArticleVersions } from "./knowledge-article-versions";
import { knowledgeReviewRequests } from "./knowledge-review-requests";

export const knowledgeArticlePublications = sqliteTable(
  "knowledge_article_publications",
  {
    id: text("id").primaryKey(),
    articleId: text("article_id")
      .notNull()
      .references(() => knowledgeArticles.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    reviewRequestId: text("review_request_id")
      .notNull()
      .references(() => knowledgeReviewRequests.id, { onDelete: "restrict" }),
    publishedByUserId: text("published_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publishedAt: text("published_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.articleId, table.versionNumber],
      foreignColumns: [
        knowledgeArticleVersions.articleId,
        knowledgeArticleVersions.versionNumber,
      ],
      name: "fk_knowledge_article_publications_version",
    }),
    uniqueIndex("uq_knowledge_article_publications_review").on(
      table.reviewRequestId,
    ),
    uniqueIndex("uq_knowledge_article_publications_article_version").on(
      table.articleId,
      table.versionNumber,
    ),
    index("idx_knowledge_article_publications_article_time").on(
      table.articleId,
      table.publishedAt,
    ),
    check(
      "knowledge_article_publications_version_positive",
      sql`${table.versionNumber} >= 1`,
    ),
  ],
);

export type KnowledgeArticlePublication =
  typeof knowledgeArticlePublications.$inferSelect;
export type NewKnowledgeArticlePublication =
  typeof knowledgeArticlePublications.$inferInsert;
