import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { knowledgeSources } from "./knowledge-sources";
import { knowledgeAiOrganizationRuns } from "./knowledge-ai-organization-runs";
import { knowledgeArticles } from "./knowledge-articles";
import { knowledgeArticleVersions } from "./knowledge-article-versions";

export const KNOWLEDGE_AI_COMPARISON_RUN_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;
export type KnowledgeAiComparisonRunStatus =
  (typeof KNOWLEDGE_AI_COMPARISON_RUN_STATUSES)[number];

export const KNOWLEDGE_COMPARISON_RELATIONSHIPS = [
  "update_existing",
  "new_article",
  "ambiguous",
  "no_match",
] as const;
export type KnowledgeComparisonRelationship =
  (typeof KNOWLEDGE_COMPARISON_RELATIONSHIPS)[number];

export const knowledgeAiComparisonRuns = sqliteTable(
  "knowledge_ai_comparison_runs",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "restrict" }),
    organizationRunId: text("organization_run_id")
      .notNull()
      .references(() => knowledgeAiOrganizationRuns.id, { onDelete: "restrict" }),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status", { enum: KNOWLEDGE_AI_COMPARISON_RUN_STATUSES })
      .notNull()
      .default("pending"),
    relationship: text("relationship", {
      enum: KNOWLEDGE_COMPARISON_RELATIONSHIPS,
    }),
    matchedArticleId: text("matched_article_id").references(
      () => knowledgeArticles.id,
      { onDelete: "set null" },
    ),
    matchedArticleVersionId: text("matched_article_version_id").references(
      () => knowledgeArticleVersions.id,
      { onDelete: "set null" },
    ),
    matchedVersionNumber: integer("matched_version_number"),
    matchConfidence: real("match_confidence"),
    candidateSnapshotJson: text("candidate_snapshot_json").notNull(),
    comparisonJson: text("comparison_json"),
    degradationLevel: text("degradation_level"),
    provider: text("provider"),
    model: text("model"),
    failureCode: text("failure_code"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_knowledge_ai_comparison_runs_source_created").on(
      table.sourceId,
      table.createdAt,
    ),
    index("idx_knowledge_ai_comparison_runs_organization_run").on(
      table.organizationRunId,
    ),
    uniqueIndex("uq_knowledge_ai_comparison_runs_active_source")
      .on(table.sourceId)
      .where(sql`${table.status} IN ('pending', 'processing')`),
    check(
      "knowledge_ai_comparison_runs_status_allowed",
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed')`,
    ),
    check(
      "knowledge_ai_comparison_runs_relationship_allowed",
      sql`${table.relationship} IS NULL OR ${table.relationship} IN ('update_existing', 'new_article', 'ambiguous', 'no_match')`,
    ),
    check(
      "knowledge_ai_comparison_runs_confidence_range",
      sql`${table.matchConfidence} IS NULL OR (${table.matchConfidence} >= 0 AND ${table.matchConfidence} <= 1)`,
    ),
    check(
      "knowledge_ai_comparison_runs_provider_safe",
      sql`${table.provider} IS NULL OR length(${table.provider}) <= 80`,
    ),
    check(
      "knowledge_ai_comparison_runs_model_safe",
      sql`${table.model} IS NULL OR length(${table.model}) <= 160`,
    ),
  ],
);

export type KnowledgeAiComparisonRun =
  typeof knowledgeAiComparisonRuns.$inferSelect;
export type NewKnowledgeAiComparisonRun =
  typeof knowledgeAiComparisonRuns.$inferInsert;
