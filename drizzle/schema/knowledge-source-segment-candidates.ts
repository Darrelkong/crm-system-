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
import { knowledgeCategories } from "./knowledge-categories";
import { knowledgeSources } from "./knowledge-sources";
import { knowledgeSourceSegments } from "./knowledge-source-segments";
import { knowledgeSourceAnalysisRuns } from "./knowledge-source-analysis-runs";
import { knowledgeArticles } from "./knowledge-articles";

export const KNOWLEDGE_SEGMENT_CANDIDATE_STATUSES = [
  "pending",
  "ready",
  "superseded",
] as const;

export type KnowledgeSegmentCandidateStatus =
  (typeof KNOWLEDGE_SEGMENT_CANDIDATE_STATUSES)[number];

export const knowledgeSourceSegmentCandidates = sqliteTable(
  "knowledge_source_segment_candidates",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "restrict" }),
    segmentId: text("segment_id")
      .notNull()
      .references(() => knowledgeSourceSegments.id, { onDelete: "restrict" }),
    analysisRunId: text("analysis_run_id")
      .notNull()
      .references(() => knowledgeSourceAnalysisRuns.id, {
        onDelete: "restrict",
      }),
    segmentIndex: integer("segment_index").notNull(),
    status: text("status", { enum: KNOWLEDGE_SEGMENT_CANDIDATE_STATUSES })
      .notNull()
      .default("pending"),
    requestedProjectCode: text("requested_project_code"),
    knowledgeCategoryId: text("knowledge_category_id").references(
      () => knowledgeCategories.id,
      { onDelete: "restrict" },
    ),
    categoryResolutionSource: text("category_resolution_source"),
    manualRequestedProjectOverride: integer("manual_requested_project_override", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    manualCategoryOverride: integer("manual_category_override", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    supersededAt: text("superseded_at"),
    supersededByAnalysisRunId: text("superseded_by_analysis_run_id").references(
      () => knowledgeSourceAnalysisRuns.id,
      { onDelete: "restrict" },
    ),
    draftArticleId: text("draft_article_id").references(() => knowledgeArticles.id, {
      onDelete: "restrict",
    }),
    convertedAt: text("converted_at"),
  },
  (table) => [
    uniqueIndex("uq_knowledge_source_segment_candidates_segment").on(
      table.segmentId,
    ),
    index("idx_knowledge_source_segment_candidates_source_status").on(
      table.sourceId,
      table.status,
    ),
    index("idx_knowledge_source_segment_candidates_analysis_run").on(
      table.analysisRunId,
    ),
    index("idx_knowledge_source_segment_candidates_draft_article").on(
      table.draftArticleId,
    ),
    check(
      "knowledge_source_segment_candidates_status_allowed",
      sql`${table.status} IN ('pending', 'ready', 'superseded')`,
    ),
    check(
      "knowledge_source_segment_candidates_index_nonnegative",
      sql`${table.segmentIndex} >= 0`,
    ),
  ],
);

export type KnowledgeSourceSegmentCandidate =
  typeof knowledgeSourceSegmentCandidates.$inferSelect;
export type NewKnowledgeSourceSegmentCandidate =
  typeof knowledgeSourceSegmentCandidates.$inferInsert;
