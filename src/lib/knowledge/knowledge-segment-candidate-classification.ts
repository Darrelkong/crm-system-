import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { isRequestedProjectCode } from "@/lib/constants/requested-projects";
import { deriveKnowledgePasteBusinessIdentity } from "@/lib/knowledge/knowledge-paste-business-identity";
import { resolveKnowledgeCategoryForBusiness } from "@/lib/knowledge/knowledge-business-category-mapping-service";
import type { KnowledgeSourceSegmentCandidate } from "../../../drizzle/schema/knowledge-source-segment-candidates";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";

export async function applyCandidateBusinessFromEvidence(
  candidate: KnowledgeSourceSegmentCandidate,
  segmentEvidenceText: string,
  db: Database,
): Promise<void> {
  if (candidate.manualRequestedProjectOverride) {
    await applyCandidateExplicitCategoryFromBusiness(candidate, db);
    return;
  }
  const identity = deriveKnowledgePasteBusinessIdentity(segmentEvidenceText);
  const now = new Date().toISOString();
  const requestedProjectCode =
    identity.categoryMatch === "confident" && identity.requestedProjectCode
      ? identity.requestedProjectCode
      : identity.requestedProjectCode;
  await db
    .update(schema.knowledgeSourceSegmentCandidates)
    .set({
      requestedProjectCode,
      updatedAt: now,
    })
    .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidate.id));
  const refreshed = (
    await db
      .select()
      .from(schema.knowledgeSourceSegmentCandidates)
      .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidate.id))
      .limit(1)
  )[0]!;
  await applyCandidateExplicitCategoryFromBusiness(refreshed, db);
}

export async function applyCandidateExplicitCategoryFromBusiness(
  candidate: KnowledgeSourceSegmentCandidate,
  db: Database,
): Promise<void> {
  if (candidate.manualCategoryOverride) {
    return;
  }
  const businessCode = candidate.requestedProjectCode;
  const now = new Date().toISOString();
  if (!businessCode || !isRequestedProjectCode(businessCode)) {
    await db
      .update(schema.knowledgeSourceSegmentCandidates)
      .set({
        knowledgeCategoryId: null,
        categoryResolutionSource: null,
        updatedAt: now,
      })
      .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidate.id));
    return;
  }
  const resolution = await resolveKnowledgeCategoryForBusiness(businessCode, db);
  if (resolution.status === "matched" && resolution.categoryId) {
    await db
      .update(schema.knowledgeSourceSegmentCandidates)
      .set({
        knowledgeCategoryId: resolution.categoryId,
        categoryResolutionSource: "explicit_mapping",
        manualCategoryOverride: false,
        updatedAt: now,
      })
      .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidate.id));
    return;
  }
  await db
    .update(schema.knowledgeSourceSegmentCandidates)
    .set({
      knowledgeCategoryId: null,
      categoryResolutionSource: null,
      updatedAt: now,
    })
    .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidate.id));
}

export async function updateCandidateManualBusiness(
  candidateId: string,
  requestedProjectCode: string | null,
  db: Database,
): Promise<KnowledgeSourceSegmentCandidate> {
  if (requestedProjectCode && !isRequestedProjectCode(requestedProjectCode)) {
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
      "关联业务无效",
      400,
    );
  }
  const now = new Date().toISOString();
  await db
    .update(schema.knowledgeSourceSegmentCandidates)
    .set({
      requestedProjectCode,
      manualRequestedProjectOverride: true,
      updatedAt: now,
    })
    .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidateId));
  const row = (
    await db
      .select()
      .from(schema.knowledgeSourceSegmentCandidates)
      .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidateId))
      .limit(1)
  )[0]!;
  await applyCandidateExplicitCategoryFromBusiness(row, db);
  return (
    await db
      .select()
      .from(schema.knowledgeSourceSegmentCandidates)
      .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidateId))
      .limit(1)
  )[0]!;
}

export async function updateCandidateManualCategory(
  candidateId: string,
  knowledgeCategoryId: string | null,
  db: Database,
): Promise<KnowledgeSourceSegmentCandidate> {
  const now = new Date().toISOString();
  await db
    .update(schema.knowledgeSourceSegmentCandidates)
    .set({
      knowledgeCategoryId,
      categoryResolutionSource: knowledgeCategoryId ? "manual" : null,
      manualCategoryOverride: Boolean(knowledgeCategoryId),
      updatedAt: now,
    })
    .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidateId));
  return (
    await db
      .select()
      .from(schema.knowledgeSourceSegmentCandidates)
      .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidateId))
      .limit(1)
  )[0]!;
}
