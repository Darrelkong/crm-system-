import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { OrganizerDraftFields } from "@/lib/knowledge/knowledge-ingest-organizer-draft";
import type { KnowledgeSegmentCandidateDetail } from "@/lib/knowledge/knowledge-segment-candidate-service";
import { currentCandidateCondition, currentCandidateOrganizationCondition, nextCandidateRevision } from "@/lib/knowledge/knowledge-candidate-guards";
import { activeMappingCategory } from "@/lib/knowledge/knowledge-segment-candidate-classification";

export async function syncCandidateCategoryFromOrganizerDraft(
  candidate: KnowledgeSegmentCandidateDetail,
  draft: OrganizerDraftFields,
  db: Database,
  organizationRunId?: string | null,
): Promise<void> {
  if (candidate.manualCategoryOverride || !draft.title || !draft.body) return;
  const mapping = activeMappingCategory(candidate.requestedProjectCode);
  const aiCategory = draft.categoryResolutionSource === "ai_suggestion" &&
    !draft.categoryAiRequiresConfirmation && draft.categoryId ? draft.categoryId : null;
  // Re-resolve the explicit mapping and category activity in the committing SQL.
  // Medium/low/error clears an older automatic fill instead of silently reusing it.
  const category = sql`COALESCE(${mapping}, (SELECT id FROM knowledge_categories
    WHERE id = ${aiCategory} AND is_active = 1))`;
  await db.update(schema.knowledgeSourceSegmentCandidates).set({
    knowledgeCategoryId: category,
    categoryResolutionSource: sql`CASE WHEN ${mapping} IS NOT NULL THEN 'explicit_mapping'
      WHEN ${category} IS NOT NULL THEN 'ai_suggestion' ELSE NULL END`,
    updatedAt: nextCandidateRevision(candidate.updatedAt),
  }).where(and(
    eq(schema.knowledgeSourceSegmentCandidates.id, candidate.id),
    eq(schema.knowledgeSourceSegmentCandidates.updatedAt, candidate.updatedAt),
    eq(schema.knowledgeSourceSegmentCandidates.manualCategoryOverride, false),
    eq(schema.knowledgeSourceSegmentCandidates.manualRequestedProjectOverride, candidate.manualRequestedProjectOverride),
    sql`${schema.knowledgeSourceSegmentCandidates.requestedProjectCode} IS ${candidate.requestedProjectCode}`,
    sql`${schema.knowledgeSourceSegmentCandidates.draftArticleId} IS NULL`,
    currentCandidateCondition(candidate),
    organizationRunId ? currentCandidateOrganizationCondition(candidate, organizationRunId) : undefined,
  ));
}
