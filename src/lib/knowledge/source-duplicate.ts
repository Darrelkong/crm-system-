import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { normalizeKnowledgeSourceText } from "@/lib/knowledge/source-text-normalization";
import type { KnowledgeSource } from "../../../drizzle/schema/knowledge-sources";

export type KnowledgeSourceDuplicateSummary = {
  id: string;
  sourceTitle: string | null;
  originalFilename: string | null;
  status: KnowledgeSource["status"];
  lifecycle: "active" | "archived";
  createdAt: string;
};

export type KnowledgeSourceDuplicateKind = "binary" | "text";

function duplicateError(
  duplicate: KnowledgeSourceDuplicateSummary,
  kind: KnowledgeSourceDuplicateKind,
): KnowledgeServiceError {
  const lifecycleLabel =
    duplicate.lifecycle === "archived" ? "archived" : "active";
  const message =
    duplicate.lifecycle === "archived"
      ? "此资料已存在于已封存来源中"
      : "此资料已经存在于有效来源中";
  return new KnowledgeServiceError(
    KNOWLEDGE_ERROR_CODES.SOURCE_DUPLICATE,
    message,
    409,
    {
      duplicate,
      duplicateKind: kind,
      duplicateLifecycle: lifecycleLabel,
    },
  );
}

function toDuplicateSummary(source: KnowledgeSource): KnowledgeSourceDuplicateSummary {
  return {
    id: source.id,
    sourceTitle: source.sourceTitle,
    originalFilename: source.originalFilename,
    status: source.status,
    lifecycle: source.archivedAt ? "archived" : "active",
    createdAt: source.createdAt,
  };
}

export async function findKnowledgeSourceByContentHash(
  contentHash: string,
  db: Database = getDb(),
): Promise<KnowledgeSource | null> {
  return (
    await db
      .select()
      .from(schema.knowledgeSources)
      .where(eq(schema.knowledgeSources.contentHash, contentHash))
      .orderBy(asc(schema.knowledgeSources.createdAt))
      .limit(1)
  )[0] ?? null;
}

export async function findKnowledgeSourceByNormalizedText(
  normalizedText: string,
  db: Database = getDb(),
): Promise<KnowledgeSource | null> {
  const rows = await db
    .select()
    .from(schema.knowledgeSources)
    .where(sql`${schema.knowledgeSources.rawText} IS NOT NULL`);
  for (const row of rows) {
    if (!row.rawText) continue;
    if (normalizeKnowledgeSourceText(row.rawText) === normalizedText) {
      return row;
    }
  }
  return null;
}

export async function assertNoBinaryDuplicate(
  contentHash: string,
  db: Database = getDb(),
): Promise<void> {
  const existing = await findKnowledgeSourceByContentHash(contentHash, db);
  if (existing) {
    throw duplicateError(toDuplicateSummary(existing), "binary");
  }
}

export async function assertNoTextDuplicate(
  normalizedText: string,
  excludeSourceId?: string,
  db: Database = getDb(),
): Promise<void> {
  const existing = await findKnowledgeSourceByNormalizedText(normalizedText, db);
  if (existing && existing.id !== excludeSourceId) {
    throw duplicateError(toDuplicateSummary(existing), "text");
  }
}

export async function resolveBinaryDuplicateRace(
  sourceId: string,
  contentHash: string,
  db: Database = getDb(),
): Promise<KnowledgeSource | null> {
  const matches = await db
    .select()
    .from(schema.knowledgeSources)
    .where(eq(schema.knowledgeSources.contentHash, contentHash))
    .orderBy(asc(schema.knowledgeSources.createdAt));
  if (matches.length <= 1) return null;
  const canonical = matches[0];
  if (canonical.id === sourceId) return null;
  if (matches.some((row) => row.id === sourceId)) {
    return canonical;
  }
  return null;
}
