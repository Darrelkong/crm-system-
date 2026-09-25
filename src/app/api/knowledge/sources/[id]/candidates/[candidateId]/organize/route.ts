import { getRequestMeta } from "@/lib/auth/cookies";
import { organizeKnowledgeSegmentCandidate } from "@/lib/knowledge/knowledge-segment-candidate-organizer-service";
import { buildCandidateOrganizerDraftPayload } from "@/lib/knowledge/knowledge-segment-candidate-organizer-draft";
import { getDb } from "@/lib/db";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { isUsableCandidateOrganizerDraft } from "@/lib/knowledge/knowledge-candidate-organizer-draft-usability";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; candidateId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: sourceId, candidateId } = await context.params;
    const actor = await requireKnowledgeAccess(request);
    const candidate = await organizeKnowledgeSegmentCandidate(
      actor,
      sourceId,
      candidateId,
      getRequestMeta(request),
      getDb(),
    );
    const payload = await buildCandidateOrganizerDraftPayload(
      actor,
      sourceId,
      candidate,
      {},
      getDb(),
    );
    if (!isUsableCandidateOrganizerDraft(payload.draft)) {
      throw new KnowledgeServiceError(
        KNOWLEDGE_ERROR_CODES.AI_OUTPUT_INVALID,
        "AI 整理结果不可用，请重新整理",
        503,
      );
    }
    return Response.json({
      candidate,
      draft: payload.draft,
      organizationRunId: payload.organizationRunId,
    });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
