import { getRequestMeta } from "@/lib/auth/cookies";
import { organizeKnowledgeSegmentCandidate } from "@/lib/knowledge/knowledge-segment-candidate-organizer-service";
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
    );
    return Response.json({ candidate });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
