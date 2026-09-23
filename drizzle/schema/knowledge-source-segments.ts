import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { knowledgeSources } from "./knowledge-sources";
import { knowledgeSourceAnalysisRuns } from "./knowledge-source-analysis-runs";

export const KNOWLEDGE_SOURCE_SEGMENT_STATUSES = [
  "proposed",
  "confirmed",
  "rejected",
  "superseded",
] as const;

export type KnowledgeSourceSegmentStatus =
  (typeof KNOWLEDGE_SOURCE_SEGMENT_STATUSES)[number];

export const knowledgeSourceSegments = sqliteTable(
  "knowledge_source_segments",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "restrict" }),
    analysisRunId: text("analysis_run_id")
      .notNull()
      .references(() => knowledgeSourceAnalysisRuns.id, { onDelete: "restrict" }),
    segmentIndex: integer("segment_index").notNull(),
    titleHint: text("title_hint").notNull(),
    evidenceText: text("evidence_text").notNull(),
    evidenceStart: integer("evidence_start").notNull(),
    evidenceEnd: integer("evidence_end").notNull(),
    status: text("status", { enum: KNOWLEDGE_SOURCE_SEGMENT_STATUSES })
      .notNull()
      .default("proposed"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_knowledge_source_segments_source_index").on(
      table.sourceId,
      table.segmentIndex,
    ),
    index("idx_knowledge_source_segments_run").on(table.analysisRunId),
    check(
      "knowledge_source_segments_status_allowed",
      sql`${table.status} IN ('proposed', 'confirmed', 'rejected', 'superseded')`,
    ),
    check(
      "knowledge_source_segments_index_nonnegative",
      sql`${table.segmentIndex} >= 0`,
    ),
    check(
      "knowledge_source_segments_offsets_valid",
      sql`${table.evidenceStart} >= 0 AND ${table.evidenceEnd} >= ${table.evidenceStart}`,
    ),
  ],
);

export type KnowledgeSourceSegment = typeof knowledgeSourceSegments.$inferSelect;
