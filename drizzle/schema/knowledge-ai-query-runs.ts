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

export const KNOWLEDGE_AI_QUERY_RUN_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;
export type KnowledgeAiQueryRunStatus =
  (typeof KNOWLEDGE_AI_QUERY_RUN_STATUSES)[number];

export const knowledgeAiQueryRuns = sqliteTable(
  "knowledge_ai_query_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status", { enum: KNOWLEDGE_AI_QUERY_RUN_STATUSES })
      .notNull()
      .default("pending"),
    queryHash: text("query_hash").notNull(),
    queryLength: integer("query_length").notNull(),
    retrievedSourceCount: integer("retrieved_source_count").notNull().default(0),
    provider: text("provider"),
    model: text("model"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    failureCode: text("failure_code"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_knowledge_ai_query_runs_user_created").on(
      table.userId,
      table.createdAt,
    ),
    index("idx_knowledge_ai_query_runs_status_created").on(
      table.status,
      table.createdAt,
    ),
    uniqueIndex("uq_knowledge_ai_query_runs_active_user")
      .on(table.userId)
      .where(
        sql`${table.status} IN ('pending', 'processing')`,
      ),
    check(
      "knowledge_ai_query_runs_status_allowed",
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed')`,
    ),
    check(
      "knowledge_ai_query_runs_query_length_valid",
      sql`${table.queryLength} >= 1 AND ${table.queryLength} <= 200`,
    ),
    check(
      "knowledge_ai_query_runs_source_count_valid",
      sql`${table.retrievedSourceCount} >= 0 AND ${table.retrievedSourceCount} <= 8`,
    ),
  ],
);

export type KnowledgeAiQueryRun = typeof knowledgeAiQueryRuns.$inferSelect;
export type NewKnowledgeAiQueryRun = typeof knowledgeAiQueryRuns.$inferInsert;
