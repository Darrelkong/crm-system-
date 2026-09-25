import type { Database } from "@/lib/db";
import { getDb } from "@/lib/db";
import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";
import {
  buildOrganizerDraftFromOrganization,
  type OrganizerDraftFields,
} from "@/lib/knowledge/knowledge-ingest-organizer-draft";
import {
  getCandidateOrganizationForDraft,
  getLatestCandidateOrganizationRunId,
} from "@/lib/knowledge/knowledge-segment-candidate-organizer-service";
import { isUsableCandidateOrganizerDraft } from "@/lib/knowledge/knowledge-candidate-organizer-draft-usability";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import type { KnowledgeSegmentCandidateDetail } from "@/lib/knowledge/knowledge-segment-candidate-service";

function syntheticSourceForCandidateDraft(
  sourceId: string,
  organization: NonNullable<KnowledgeSourceDetail["organization"]>,
): KnowledgeSourceDetail {
  return {
    id: sourceId,
    sourceType: "paste",
    sourceTitle: null,
    originalFilename: null,
    mimeType: null,
    sizeBytes: 0,
    status: "organized",
    analysisStatus: "ready_for_review",
    failureCode: null,
    linkedArticleId: null,
    createdByUserId: "synthetic",
    archivedAt: null,
    archivedByUserId: null,
    createdAt: "",
    updatedAt: "",
    processedAt: null,
    rawText: "",
    storageKey: null,
    contentHash: "synthetic",
    extractionMethod: null,
    extractionModel: null,
    extractionMetadata: null,
    pageCount: null,
    organization,
    smartIngestScope: {
      analysisStatus: "ready_for_review",
      latestAnalysisRunId: null,
      segments: [],
      unconfirmedProposedCount: 0,
      confirmedSegmentCount: 3,
      rejectedSegmentCount: 0,
      retainedProposedSegmentCount: 0,
      activeSegmentCount: 3,
      blocksSourceLevelOrganize: true,
      blocksSourceLevelComparison: true,
      singleSegmentId: null,
      singleSegmentEvidenceText: null,
    },
  };
}

export type CandidateOrganizerDraftPayload = {
  draft: OrganizerDraftFields;
  organizationRunId: string | null;
  organizationUsable: boolean;
};

export async function buildCandidateOrganizerDraftPayload(
  context: KnowledgeSessionContext,
  sourceId: string,
  candidate: KnowledgeSegmentCandidateDetail,
  options: {
    manualRequestedProjectCode?: string | null;
    manualRequestedProjectOverride?: boolean;
    manualCategoryId?: string | null;
    manualCategoryOverride?: boolean;
  },
  db: Database = getDb(),
): Promise<CandidateOrganizerDraftPayload> {
  const draft = await buildCandidateOrganizerDraft(
    context,
    sourceId,
    candidate,
    options,
    db,
  );
  const organizationRunId = await getLatestCandidateOrganizationRunId(
    candidate.id,
    db,
  );
  return {
    draft,
    organizationRunId,
    organizationUsable: isUsableCandidateOrganizerDraft(draft),
  };
}

export async function buildCandidateOrganizerDraft(
  context: KnowledgeSessionContext,
  sourceId: string,
  candidate: KnowledgeSegmentCandidateDetail,
  options: {
    manualRequestedProjectCode?: string | null;
    manualRequestedProjectOverride?: boolean;
    manualCategoryId?: string | null;
    manualCategoryOverride?: boolean;
  },
  db: Database = getDb(),
): Promise<OrganizerDraftFields> {
  const organization = await getCandidateOrganizationForDraft(
    context,
    sourceId,
    candidate.id,
    db,
  );
  if (!organization || organization.status !== "completed") {
    return {
      title: "",
      summary: "",
      body: "",
      requestedProjectCode: candidate.requestedProjectCode,
      requestedProjectName: "",
      categoryId: candidate.knowledgeCategoryId ?? "",
      categoryNotice: "none",
      categoryResolutionSource:
        candidate.categoryResolutionSource === "explicit_mapping"
          ? "explicit_mapping"
          : candidate.categoryResolutionSource === "manual"
            ? "manual"
            : null,
      categoryResolutionStatus: null,
      categoryAiSuggestion: null,
      suggestedCategoryId: null,
      suggestedCategoryName: null,
      categoryAiRequiresConfirmation: false,
      categorySelectionRequired: !candidate.knowledgeCategoryId,
    };
  }

  const manualRequestedProjectCode =
    options.manualRequestedProjectOverride === true
      ? (options.manualRequestedProjectCode ?? candidate.requestedProjectCode)
      : candidate.manualRequestedProjectOverride
        ? candidate.requestedProjectCode
        : (options.manualRequestedProjectCode ?? candidate.requestedProjectCode);

  const manualCategoryId =
    options.manualCategoryOverride === true
      ? (options.manualCategoryId ?? candidate.knowledgeCategoryId)
      : candidate.manualCategoryOverride
        ? candidate.knowledgeCategoryId
        : (options.manualCategoryId ?? candidate.knowledgeCategoryId);

  return buildOrganizerDraftFromOrganization(
    syntheticSourceForCandidateDraft(sourceId, organization),
    {
      manualRequestedProjectCode,
      manualRequestedProjectOverride:
        options.manualRequestedProjectOverride ??
        candidate.manualRequestedProjectOverride,
      manualCategoryId,
      manualCategoryOverride:
        options.manualCategoryOverride ?? candidate.manualCategoryOverride,
    },
    db,
    undefined,
    { bypassSourceLevelOrganizeBlock: true },
  );
}
