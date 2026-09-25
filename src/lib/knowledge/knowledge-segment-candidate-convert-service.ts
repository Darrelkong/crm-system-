import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  createKnowledgeArticle,
  parseArticleInput,
} from "@/lib/knowledge/core-service";
import {
  comparisonMatchesOrganizerDraft,
  normalizeComparedOrganizerDraft,
} from "@/lib/knowledge/knowledge-candidate-comparison-draft";
import { hasUsableComparedOrganizerDraft } from "@/lib/knowledge/knowledge-candidate-comparison-draft";
import {
  getLatestKnowledgeSegmentCandidateComparison,
} from "@/lib/knowledge/comparison-service";
import { getKnowledgeArticle } from "@/lib/knowledge/core-service";
import {
  requireManageableKnowledgeSource,
  type KnowledgeSourceMeta,
} from "@/lib/knowledge/source-service";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import { getKnowledgeSegmentCandidate } from "@/lib/knowledge/knowledge-segment-candidate-service";

function convertError(
  code: string,
  message: string,
  status = 400,
): KnowledgeServiceError {
  return new KnowledgeServiceError(code, message, status);
}

export async function sourceHasConvertedSegmentCandidates(
  sourceId: string,
  db: Database = getDb(),
): Promise<boolean> {
  const row = (
    await db
      .select({ id: schema.knowledgeSourceSegmentCandidates.id })
      .from(schema.knowledgeSourceSegmentCandidates)
      .where(
        and(
          eq(schema.knowledgeSourceSegmentCandidates.sourceId, sourceId),
          isNotNull(schema.knowledgeSourceSegmentCandidates.draftArticleId),
          inArray(schema.knowledgeSourceSegmentCandidates.status, [
            "pending",
            "ready",
          ]),
        ),
      )
      .limit(1)
  )[0];
  return Boolean(row);
}

export async function convertKnowledgeSegmentCandidateToDraft(
  context: KnowledgeSessionContext,
  sourceId: string,
  candidateId: string,
  input: {
    title: unknown;
    summary?: unknown;
    body: unknown;
    categoryId?: unknown;
    visibility?: unknown;
    changeNote?: unknown;
  },
  meta: KnowledgeSourceMeta,
  db: Database = getDb(),
) {
  const source = await requireManageableKnowledgeSource(
    context,
    sourceId,
    db,
    "来源转换权限不足",
  );
  if (source.archivedAt) {
    throw convertError(
      KNOWLEDGE_ERROR_CODES.SOURCE_ARCHIVED,
      "已归档来源无法保存草稿",
      409,
    );
  }
  const candidate = await getKnowledgeSegmentCandidate(
    context,
    sourceId,
    candidateId,
    db,
  );
  if (!candidate || candidate.status === "superseded") {
    throw convertError(
      KNOWLEDGE_ERROR_CODES.SOURCE_NOT_FOUND,
      "主题候选不存在",
      404,
    );
  }

  const existingRow = (
    await db
      .select()
      .from(schema.knowledgeSourceSegmentCandidates)
      .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidateId))
      .limit(1)
  )[0];
  if (existingRow?.draftArticleId) {
    const article = await getKnowledgeArticle(
      context,
      existingRow.draftArticleId,
      db,
    );
    if (article) {
      return article;
    }
  }

  const draft = normalizeComparedOrganizerDraft({
    title: String(input.title ?? ""),
    summary: String(input.summary ?? ""),
    body: String(input.body ?? ""),
  });
  if (!hasUsableComparedOrganizerDraft(draft)) {
    throw convertError(
      KNOWLEDGE_ERROR_CODES.AI_OUTPUT_INVALID,
      "请先完成独立整理并填写标题、摘要与正文",
      409,
    );
  }

  const categoryId =
    (typeof input.categoryId === "string" && input.categoryId.trim()) ||
    candidate.knowledgeCategoryId;
  if (!categoryId) {
    throw convertError(
      KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
      "请先选择知识库分类",
      409,
    );
  }

  const comparison = await getLatestKnowledgeSegmentCandidateComparison(
    context,
    sourceId,
    candidateId,
    db,
  );
  if (!comparison || comparison.status !== "completed" || !comparison.comparison) {
    throw convertError(
      KNOWLEDGE_ERROR_CODES.AI_COMPARISON_REQUIRED,
      "请先完成知识比较",
      409,
    );
  }
  if (!comparisonMatchesOrganizerDraft(comparison.comparison, draft)) {
    throw convertError(
      KNOWLEDGE_ERROR_CODES.AI_COMPARISON_STALE,
      "整理内容已变更，请重新比较",
      409,
    );
  }

  const values = parseArticleInput({
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    categoryId,
    visibility: input.visibility,
    changeNote: input.changeNote,
  });

  const article = await createKnowledgeArticle(
    context,
    {
      title: values.title,
      categoryId: values.categoryId,
      summary: values.summary,
      body: values.body,
      visibility: values.visibility,
      changeNote:
        values.changeNote ??
        "由 Smart Ingest 主题候选人工审核后建立",
    },
    meta,
    db,
  );

  const now = new Date().toISOString();
  await db
    .update(schema.knowledgeSourceSegmentCandidates)
    .set({
      draftArticleId: article.id,
      convertedAt: now,
      updatedAt: now,
      status: "ready",
    })
    .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidateId));

  return article;
}
