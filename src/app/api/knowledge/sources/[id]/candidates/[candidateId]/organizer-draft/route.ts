import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  buildCandidateOrganizerDraft,
  buildCandidateOrganizerDraftPayload,
} from "@/lib/knowledge/knowledge-segment-candidate-organizer-draft";
import { syncCandidateCategoryFromOrganizerDraft } from "@/lib/knowledge/knowledge-segment-candidate-draft-sync";
import {
  getActiveSegmentCandidate,
} from "@/lib/knowledge/knowledge-segment-candidate-organizer-service";
import {
  updateCandidateManualBusiness,
  updateCandidateManualCategory,
} from "@/lib/knowledge/knowledge-segment-candidate-classification";
import { getDb } from "@/lib/db";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; candidateId: string }>;
};

type OrganizerDraftRequestBody = {
  manualRequestedProjectCode?: string | null;
  manualRequestedProjectOverride?: boolean;
  manualCategoryId?: string | null;
  manualCategoryOverride?: boolean;
  adoptCategorySuggestion?: boolean;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: sourceId, candidateId } = await context.params;
    const actor = await requireKnowledgeAccess(request);
    const db = getDb();
    let body: OrganizerDraftRequestBody = {};
    try {
      body = (await request.json()) as OrganizerDraftRequestBody;
    } catch {
      throw new KnowledgeServiceError(
        KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
        "Invalid organizer draft request",
        400,
      );
    }

    let candidate = await getActiveSegmentCandidate(
      actor,
      sourceId,
      candidateId,
      db,
    );

    if (body.manualRequestedProjectOverride === true) {
      await updateCandidateManualBusiness(
        candidateId,
        body.manualRequestedProjectCode ?? null,
        db,
      );
      candidate = await getActiveSegmentCandidate(
        actor,
        sourceId,
        candidateId,
        db,
      );
    }

    if (body.adoptCategorySuggestion === true) {
      const preview = await buildCandidateOrganizerDraft(
        actor,
        sourceId,
        candidate,
        {},
        db,
      );
      if (preview.suggestedCategoryId) {
        await updateCandidateManualCategory(
          candidateId,
          preview.suggestedCategoryId,
          db,
        );
        candidate = await getActiveSegmentCandidate(
          actor,
          sourceId,
          candidateId,
          db,
        );
      }
    } else if (body.manualCategoryOverride === true) {
      await updateCandidateManualCategory(
        candidateId,
        body.manualCategoryId ?? null,
        db,
      );
      candidate = await getActiveSegmentCandidate(
        actor,
        sourceId,
        candidateId,
        db,
      );
    }

    const payload = await buildCandidateOrganizerDraftPayload(
      actor,
      sourceId,
      candidate,
      {
        manualRequestedProjectCode: body.manualRequestedProjectCode,
        manualRequestedProjectOverride: body.manualRequestedProjectOverride,
        manualCategoryId: body.manualCategoryId,
        manualCategoryOverride: body.manualCategoryOverride,
      },
      db,
    );

    await syncCandidateCategoryFromOrganizerDraft(
      candidate,
      payload.draft,
      db,
    );
    const refreshed = await getActiveSegmentCandidate(
      actor,
      sourceId,
      candidateId,
      db,
    );

    return Response.json({
      draft: payload.draft,
      organizationRunId: payload.organizationRunId,
      organizationUsable: payload.organizationUsable,
      candidate: refreshed,
    });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
