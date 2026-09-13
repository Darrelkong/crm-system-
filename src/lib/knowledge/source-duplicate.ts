import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { isKnowledgeImageFilename } from "@/lib/knowledge/source-image-validation";
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

export function isFailedVisionImageDuplicate(
  duplicate: KnowledgeSourceDuplicateSummary,
): boolean {
  return (
    duplicate.lifecycle === "active" &&
    duplicate.status === "failed" &&
    Boolean(
      duplicate.originalFilename &&
        isKnowledgeImageFilename(duplicate.originalFilename),
    )
  );
}

function duplicateErrorMessage(
  duplicate: KnowledgeSourceDuplicateSummary,
): string {
  if (duplicate.lifecycle === "archived") {
    return "此资料已存在于已封存来源中";
  }
  if (isFailedVisionImageDuplicate(duplicate)) {
    return "相同檔案先前讀取失敗，原始檔案已安全保留";
  }
  return "此资料已经存在于有效来源中";
}

function duplicateError(
  duplicate: KnowledgeSourceDuplicateSummary,
  kind: KnowledgeSourceDuplicateKind,
): KnowledgeServiceError {
  const lifecycleLabel =
    duplicate.lifecycle === "archived" ? "archived" : "active";
  return new KnowledgeServiceError(
    KNOWLEDGE_ERROR_CODES.SOURCE_DUPLICATE,
    duplicateErrorMessage(duplicate),
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
