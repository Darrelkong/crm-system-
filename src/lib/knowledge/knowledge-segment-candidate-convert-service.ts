import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
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
import { candidateConflict, currentCandidateCondition, currentCandidateOrganizationCondition, nextCandidateRevision, requireCurrentCandidate } from "@/lib/knowledge/knowledge-candidate-guards";
import { buildKnowledgeAuditInsertWhere } from "@/lib/knowledge/audit";

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
  const candidate = await requireCurrentCandidate(context, sourceId, candidateId, db);
  if (candidate.draftArticleId) {
    return getKnowledgeArticle(context, candidate.draftArticleId, db);
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
  if (categoryId !== candidate.knowledgeCategoryId) throw candidateConflict();
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

  if (values.visibility === "restricted" && context.role !== "knowledge_admin") {
    throw convertError(KNOWLEDGE_ERROR_CODES.ARTICLE_ACCESS_DENIED, "Restricted 文章目前只能由 Knowledge Admin 建立", 403);
  }
  const category = (await db.select().from(schema.knowledgeCategories)
    .where(and(eq(schema.knowledgeCategories.id, values.categoryId),
      eq(schema.knowledgeCategories.isActive, true))).limit(1))[0];
  if (!category) throw convertError(KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID, "请选择有效的启用分类");

  const articleId = crypto.randomUUID();
  const now = nextCandidateRevision(candidate.updatedAt);
  const ownerUserId = values.visibility === "owner" ? context.user.id : null;
  const eligible = and(
    currentCandidateCondition(candidate, context),
    currentCandidateOrganizationCondition(candidate, comparison.organizationRunId),
    sql`EXISTS (SELECT 1 FROM knowledge_source_segment_candidates
      WHERE id = ${candidateId} AND draft_article_id IS NULL AND updated_at = ${candidate.updatedAt})`,
    sql`EXISTS (SELECT 1 FROM knowledge_categories WHERE id = ${values.categoryId} AND is_active = 1)`,
    sql`EXISTS (SELECT 1 FROM knowledge_ai_comparison_runs cmp
      WHERE cmp.id = ${comparison.id} AND cmp.candidate_id = ${candidateId}
        AND cmp.source_id = ${sourceId} AND cmp.organization_run_id = ${comparison.organizationRunId}
        AND cmp.status = 'completed'
        AND cmp.rowid = (SELECT rowid FROM knowledge_ai_comparison_runs
          WHERE candidate_id = ${candidateId} ORDER BY created_at DESC, rowid DESC LIMIT 1))`,
  )!;
  const created = sql`EXISTS (SELECT 1 FROM knowledge_articles WHERE id = ${articleId})`;
  // D1 serializes this batch as one transaction. A losing request inserts nothing;
  // every dependent statement is gated by this request's newly generated Article ID.
  try {
    await db.batch([
      db.insert(schema.knowledgeArticles).select(sql`
        SELECT ${articleId}, ${values.categoryId}, ${values.title}, ${values.summary},
          ${values.body}, 'draft', ${values.visibility}, ${ownerUserId}, 1, NULL,
          ${context.user.id}, ${context.user.id}, ${now}, ${now}, NULL
        WHERE ${eligible}
      `),
      db.insert(schema.knowledgeArticleVersions).select(sql`
        SELECT ${crypto.randomUUID()}, ${articleId}, 1, ${values.title}, ${values.summary},
          ${values.body}, ${values.categoryId}, ${values.visibility}, ${ownerUserId},
          ${values.changeNote ?? "由 Smart Ingest 主题候选人工审核后建立"}, ${context.user.id}, ${now}
        WHERE ${created}
      `),
      buildKnowledgeAuditInsertWhere(db, {
        userId: context.user.id, action: "knowledge_article_create", entityType: "knowledge_article",
        entityId: articleId, ...meta,
        metadata: { versionNumber: 1, categoryId: values.categoryId, sourceId, candidateId },
      }, created),
      db.update(schema.knowledgeSourceSegmentCandidates).set({
        draftArticleId: articleId, convertedAt: now, updatedAt: now, status: "ready",
      }).where(and(eq(schema.knowledgeSourceSegmentCandidates.id, candidateId),
        isNull(schema.knowledgeSourceSegmentCandidates.draftArticleId), created)),
    ]);
  } catch (error) {
    // A transport error may arrive after COMMIT. Recover only via canonical linkage.
    const recovered = (await db.select().from(schema.knowledgeSourceSegmentCandidates)
      .where(and(eq(schema.knowledgeSourceSegmentCandidates.id, candidateId),
        eq(schema.knowledgeSourceSegmentCandidates.sourceId, sourceId))).limit(1))[0];
    if (recovered?.draftArticleId) return getKnowledgeArticle(context, recovered.draftArticleId, db);
    throw error;
  }
  const linked = (await db.select().from(schema.knowledgeSourceSegmentCandidates)
    .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidateId)).limit(1))[0];
  if (!linked?.draftArticleId) throw candidateConflict();
  return getKnowledgeArticle(context, linked.draftArticleId, db);
}
