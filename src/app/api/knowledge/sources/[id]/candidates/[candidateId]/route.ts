import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  updateCandidateManualBusiness,
  updateCandidateManualCategory,
} from "@/lib/knowledge/knowledge-segment-candidate-classification";
import { getActiveSegmentCandidate } from "@/lib/knowledge/knowledge-segment-candidate-organizer-service";
import { getDb } from "@/lib/db";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; candidateId: string }>;
};

type PatchBody = {
  requestedProjectCode?: string | null;
  knowledgeCategoryId?: string | null;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id: sourceId, candidateId } = await context.params;
    const actor = await requireKnowledgeAccess(request);
    const db = getDb();
    let body: PatchBody = {};
    try {
      body = (await request.json()) as PatchBody;
    } catch {
      throw new KnowledgeServiceError(
        KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
        "Invalid candidate update",
        400,
      );
    }

    if (body.requestedProjectCode !== undefined) {
      await updateCandidateManualBusiness(
        candidateId,
        body.requestedProjectCode,
        db,
      );
    }
    if (body.knowledgeCategoryId !== undefined) {
      await updateCandidateManualCategory(
        candidateId,
        body.knowledgeCategoryId,
        db,
      );
    }

    const candidate = await getActiveSegmentCandidate(
      actor,
      sourceId,
      candidateId,
      db,
    );
    return Response.json({ candidate });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
