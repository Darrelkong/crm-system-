import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { knowledgeArticles } from "./knowledge-articles";

export const KNOWLEDGE_SOURCE_TYPES = ["paste", "file"] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export const KNOWLEDGE_SOURCE_STATUSES = [
  "received",
  "extracting",
  "ready",
  "organizing",
  "organized",
  "failed",
  "converted",
] as const;
export type KnowledgeSourceStatus =
  (typeof KNOWLEDGE_SOURCE_STATUSES)[number];

export const knowledgeSources = sqliteTable(
  "knowledge_sources",
  {
    id: text("id").primaryKey(),
    sourceType: text("source_type", {
      enum: KNOWLEDGE_SOURCE_TYPES,
    }).notNull(),
    sourceTitle: text("source_title"),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    rawText: text("raw_text"),
    storageKey: text("storage_key"),
    contentHash: text("content_hash").notNull(),
    status: text("status", { enum: KNOWLEDGE_SOURCE_STATUSES })
      .notNull()
      .default("received"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    processedAt: text("processed_at"),
    failureCode: text("failure_code"),
    linkedArticleId: text("linked_article_id").references(
      () => knowledgeArticles.id,
      { onDelete: "set null" },
    ),
  },
  (table) => [
    index("idx_knowledge_sources_creator_updated").on(
      table.createdByUserId,
      table.updatedAt,
    ),
    index("idx_knowledge_sources_status_updated").on(
      table.status,
      table.updatedAt,
    ),
    index("idx_knowledge_sources_content_hash").on(table.contentHash),
    check(
      "knowledge_sources_type_allowed",
      sql`${table.sourceType} IN ('paste', 'file')`,
    ),
    check(
      "knowledge_sources_status_allowed",
      sql`${table.status} IN ('received', 'extracting', 'ready', 'organizing', 'organized', 'failed', 'converted')`,
    ),
    check(
      "knowledge_sources_content_hash_not_blank",
      sql`length(trim(${table.contentHash})) > 0`,
    ),
    check(
      "knowledge_sources_size_nonnegative",
      sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`,
    ),
    check(
      "knowledge_sources_storage_or_text",
      sql`${table.sourceType} <> 'file' OR ${table.storageKey} IS NOT NULL`,
    ),
  ],
);

export type KnowledgeSource = typeof knowledgeSources.$inferSelect;
export type NewKnowledgeSource = typeof knowledgeSources.$inferInsert;
