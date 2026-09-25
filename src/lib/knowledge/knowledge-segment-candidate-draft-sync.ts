import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { OrganizerDraftFields } from "@/lib/knowledge/knowledge-ingest-organizer-draft";
import type { KnowledgeSegmentCandidateDetail } from "@/lib/knowledge/knowledge-segment-candidate-service";

export async function syncCandidateCategoryFromOrganizerDraft(
  candidate: KnowledgeSegmentCandidateDetail,
  draft: OrganizerDraftFields,
  db: Database,
): Promise<void> {
  if (candidate.manualCategoryOverride) {
    return;
  }
  const now = new Date().toISOString();
  if (
    draft.categoryResolutionSource === "explicit_mapping" &&
    draft.categoryId
  ) {
    await db
      .update(schema.knowledgeSourceSegmentCandidates)
      .set({
        knowledgeCategoryId: draft.categoryId,
        categoryResolutionSource: "explicit_mapping",
        updatedAt: now,
      })
      .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidate.id));
    return;
  }
  if (
    draft.categoryResolutionSource === "ai_suggestion" &&
    draft.categoryId &&
    !draft.categoryAiRequiresConfirmation
  ) {
    await db
      .update(schema.knowledgeSourceSegmentCandidates)
      .set({
        knowledgeCategoryId: draft.categoryId,
        categoryResolutionSource: "ai_suggestion",
        updatedAt: now,
      })
      .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidate.id));
  }
}
