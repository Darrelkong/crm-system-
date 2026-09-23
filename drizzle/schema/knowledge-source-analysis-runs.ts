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

export const KNOWLEDGE_SOURCE_ANALYSIS_RUN_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;

export type KnowledgeSourceAnalysisRunStatus =
  (typeof KNOWLEDGE_SOURCE_ANALYSIS_RUN_STATUSES)[number];

export const KNOWLEDGE_SOURCE_ANALYSIS_SCHEMA_VERSION = "smart-ingest-v1";
export const KNOWLEDGE_SOURCE_ANALYSIS_SEGMENTATION_MODE = "deterministic";

export const knowledgeSourceAnalysisRuns = sqliteTable(
  "knowledge_source_analysis_runs",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "restrict" }),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status", { enum: KNOWLEDGE_SOURCE_ANALYSIS_RUN_STATUSES })
      .notNull()
      .default("pending"),
    schemaVersion: text("schema_version").notNull(),
    segmentationMode: text("segmentation_mode").notNull(),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_knowledge_analysis_runs_source_created").on(
      table.sourceId,
      table.createdAt,
    ),
    uniqueIndex("uq_knowledge_analysis_runs_active_source")
      .on(table.sourceId)
      .where(sql`${table.status} IN ('pending', 'processing')`),
    check(
      "knowledge_analysis_runs_status_allowed",
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'cancelled')`,
    ),
  ],
);

export type KnowledgeSourceAnalysisRun =
  typeof knowledgeSourceAnalysisRuns.$inferSelect;
