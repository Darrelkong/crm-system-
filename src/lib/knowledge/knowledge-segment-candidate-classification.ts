import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { isRequestedProjectCode } from "@/lib/constants/requested-projects";
import { deriveKnowledgePasteBusinessIdentity } from "@/lib/knowledge/knowledge-paste-business-identity";
import type { KnowledgeSourceSegmentCandidate } from "../../../drizzle/schema/knowledge-source-segment-candidates";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { candidateConflict, currentCandidateCondition, nextCandidateRevision, requireCurrentCandidate } from "@/lib/knowledge/knowledge-candidate-guards";
import { getKnowledgeSegmentCandidate } from "@/lib/knowledge/knowledge-segment-candidate-service";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";

export function activeMappingCategory(code: string | null) {
  return sql<string | null>`(SELECT m.knowledge_category_id
    FROM knowledge_business_category_mappings m
    JOIN knowledge_categories cat ON cat.id = m.knowledge_category_id
    WHERE m.requested_project_code = ${code} AND m.is_active = 1 AND cat.is_active = 1 LIMIT 1)`;
}

export async function applyCandidateBusinessFromEvidence(
  candidate: KnowledgeSourceSegmentCandidate,
  segmentEvidenceText: string,
  db: Database,
): Promise<void> {
  const code = candidate.manualRequestedProjectOverride
    ? candidate.requestedProjectCode
    : deriveKnowledgePasteBusinessIdentity(segmentEvidenceText).requestedProjectCode;
  const category = activeMappingCategory(code);
  await db.update(schema.knowledgeSourceSegmentCandidates).set({
    requestedProjectCode: code,
    ...(candidate.manualCategoryOverride ? {} : {
      knowledgeCategoryId: category,
      categoryResolutionSource: sql`CASE WHEN ${category} IS NULL THEN NULL ELSE 'explicit_mapping' END`,
    }),
    updatedAt: nextCandidateRevision(candidate.updatedAt),
  }).where(and(
    eq(schema.knowledgeSourceSegmentCandidates.id, candidate.id),
    eq(schema.knowledgeSourceSegmentCandidates.updatedAt, candidate.updatedAt),
    eq(schema.knowledgeSourceSegmentCandidates.manualRequestedProjectOverride, candidate.manualRequestedProjectOverride),
    eq(schema.knowledgeSourceSegmentCandidates.manualCategoryOverride, candidate.manualCategoryOverride),
    sql`${schema.knowledgeSourceSegmentCandidates.draftArticleId} IS NULL`,
    currentCandidateCondition(candidate),
  ));
}

const manualUpdateSchema = z.object({
  requestedProjectCode: z.string().trim().refine(isRequestedProjectCode).nullable().optional(),
  knowledgeCategoryId: z.uuid().nullable().optional(),
  restoreAutomaticClassification: z.literal(true).optional(),
}).strict().refine((body) => Object.keys(body).length > 0)
  .refine((body) => !body.restoreAutomaticClassification || body.knowledgeCategoryId === undefined);

export function parseCandidateManualUpdate(input: unknown) {
  const parsed = manualUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new KnowledgeServiceError(KNOWLEDGE_ERROR_CODES.SOURCE_INVALID, "主题分类更新格式无效", 400);
  }
  return parsed.data;
}

/** Validate the entire action before a single scoped CAS update. No partial PATCH writes. */
export async function updateCandidateManualClassification(
  context: KnowledgeSessionContext,
  sourceId: string,
  candidateId: string,
  input: unknown,
  db: Database,
  expectedRevision?: string,
) {
  const candidate = await requireCurrentCandidate(context, sourceId, candidateId, db);
  if (candidate.draftArticleId || (expectedRevision && candidate.updatedAt !== expectedRevision)) throw candidateConflict();
  const values = parseCandidateManualUpdate(input);
  if (values.knowledgeCategoryId) {
    const category = (await db.select().from(schema.knowledgeCategories)
      .where(and(eq(schema.knowledgeCategories.id, values.knowledgeCategoryId),
        eq(schema.knowledgeCategories.isActive, true))).limit(1))[0];
    if (!category) throw new KnowledgeServiceError(KNOWLEDGE_ERROR_CODES.CATEGORY_INVALID, "请选择有效的启用分类", 400);
  }
  const detail = await getKnowledgeSegmentCandidate(context, sourceId, candidateId, db);
  if (!detail) throw candidateConflict();
  const update = { updatedAt: nextCandidateRevision(candidate.updatedAt) };
  const businessUpdate = values.requestedProjectCode !== undefined ? {
    requestedProjectCode: values.requestedProjectCode,
    manualRequestedProjectOverride: true,
  } : {};
  const category = values.restoreAutomaticClassification || values.requestedProjectCode !== undefined
    ? activeMappingCategory(values.requestedProjectCode !== undefined
      ? values.requestedProjectCode : candidate.requestedProjectCode) : null;
  const categoryUpdate = values.knowledgeCategoryId !== undefined ? {
    knowledgeCategoryId: values.knowledgeCategoryId,
    categoryResolutionSource: "manual",
    manualCategoryOverride: true,
  } : category && (values.restoreAutomaticClassification || !candidate.manualCategoryOverride) ? {
    knowledgeCategoryId: category,
    categoryResolutionSource: sql`CASE WHEN ${category} IS NULL THEN NULL ELSE 'explicit_mapping' END`,
    ...(values.restoreAutomaticClassification ? { manualCategoryOverride: false } : {}),
  } : {};
  const updated = await db.update(schema.knowledgeSourceSegmentCandidates)
    .set({ ...update, ...businessUpdate, ...categoryUpdate })
    .where(and(
      eq(schema.knowledgeSourceSegmentCandidates.id, candidateId),
      eq(schema.knowledgeSourceSegmentCandidates.updatedAt, candidate.updatedAt),
      sql`${schema.knowledgeSourceSegmentCandidates.draftArticleId} IS NULL`,
      currentCandidateCondition(candidate, context),
      values.knowledgeCategoryId ? sql`EXISTS (SELECT 1 FROM knowledge_categories
        WHERE id = ${values.knowledgeCategoryId} AND is_active = 1)` : undefined,
    )).returning();
  if (!updated[0]) throw candidateConflict();
  // Return the committed snapshot; a later lifecycle transition must not turn a
  // successful PATCH into a 409 after it already wrote the classification.
  return { ...detail, ...updated[0] };
}
