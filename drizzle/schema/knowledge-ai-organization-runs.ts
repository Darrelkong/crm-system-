import {
  check,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { knowledgeSources } from "./knowledge-sources";

export const KNOWLEDGE_AI_RUN_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;
export type KnowledgeAiRunStatus =
  (typeof KNOWLEDGE_AI_RUN_STATUSES)[number];

export const knowledgeAiOrganizationRuns = sqliteTable(
  "knowledge_ai_organization_runs",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "restrict" }),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status", { enum: KNOWLEDGE_AI_RUN_STATUSES })
      .notNull()
      .default("pending"),
    provider: text("provider"),
    model: text("model"),
    proposedTitle: text("proposed_title"),
    proposedSummary: text("proposed_summary"),
    proposedBody: text("proposed_body"),
    proposedCategory: text("proposed_category"),
    warningsJson: text("warnings_json"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
    failureCode: text("failure_code"),
  },
  (table) => [
    index("idx_knowledge_ai_runs_source_created").on(
      table.sourceId,
      table.createdAt,
    ),
    index("idx_knowledge_ai_runs_requester_created").on(
      table.requestedByUserId,
      table.createdAt,
    ),
    uniqueIndex("uq_knowledge_ai_runs_active_source")
      .on(table.sourceId)
      .where(sql`${table.status} IN ('pending', 'processing')`),
    check(
      "knowledge_ai_runs_status_allowed",
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed')`,
    ),
    check(
      "knowledge_ai_runs_provider_safe",
      sql`${table.provider} IS NULL OR length(${table.provider}) <= 80`,
    ),
    check(
      "knowledge_ai_runs_model_safe",
      sql`${table.model} IS NULL OR length(${table.model}) <= 160`,
    ),
  ],
);

export type KnowledgeAiOrganizationRun =
  typeof knowledgeAiOrganizationRuns.$inferSelect;
export type NewKnowledgeAiOrganizationRun =
  typeof knowledgeAiOrganizationRuns.$inferInsert;
