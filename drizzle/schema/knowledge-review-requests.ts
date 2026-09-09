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

export const KNOWLEDGE_REVIEW_STATUSES = [
  "pending",
  "changes_requested",
  "approved",
  "withdrawn",
  "superseded",
] as const;
export type KnowledgeReviewStatus =
  (typeof KNOWLEDGE_REVIEW_STATUSES)[number];

export const knowledgeReviewRequests = sqliteTable(
  "knowledge_review_requests",
  {
    id: text("id").primaryKey(),
    articleId: text("article_id")
      .notNull()
      .references(() => knowledgeArticles.id, { onDelete: "restrict" }),
    submittedVersionNumber: integer("submitted_version_number").notNull(),
    submittedByUserId: text("submitted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    assignedReviewerUserId: text("assigned_reviewer_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    status: text("status", { enum: KNOWLEDGE_REVIEW_STATUSES })
      .notNull()
      .default("pending"),
    submissionNote: text("submission_note"),
    reviewNote: text("review_note"),
    dueAt: text("due_at"),
    submittedAt: text("submitted_at").notNull(),
    reviewStartedAt: text("review_started_at"),
    decidedAt: text("decided_at"),
    decidedByUserId: text("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    withdrawnAt: text("withdrawn_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_knowledge_review_requests_status_updated").on(
      table.status,
      table.updatedAt,
    ),
    index("idx_knowledge_review_requests_article_created").on(
      table.articleId,
      table.createdAt,
    ),
    index("idx_knowledge_review_requests_reviewer_status").on(
      table.assignedReviewerUserId,
      table.status,
    ),
    uniqueIndex("uq_knowledge_review_requests_active_article")
      .on(table.articleId)
      .where(sql`${table.status} = 'pending'`),
    check(
      "knowledge_review_requests_status_allowed",
      sql`${table.status} IN ('pending', 'changes_requested', 'approved', 'withdrawn', 'superseded')`,
    ),
    check(
      "knowledge_review_requests_version_positive",
      sql`${table.submittedVersionNumber} >= 1`,
    ),
    check(
      "knowledge_review_requests_terminal_decision_consistent",
      sql`${table.status} IN ('pending', 'changes_requested') OR ${table.decidedAt} IS NOT NULL OR ${table.withdrawnAt} IS NOT NULL`,
    ),
  ],
);

export type KnowledgeReviewRequest = typeof knowledgeReviewRequests.$inferSelect;
export type NewKnowledgeReviewRequest =
  typeof knowledgeReviewRequests.$inferInsert;
