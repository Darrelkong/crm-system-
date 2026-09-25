import { getLatestKnowledgeSegmentCandidateComparison } from "@/lib/knowledge/comparison-service";
import { getDb } from "@/lib/db";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; candidateId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id: sourceId, candidateId } = await context.params;
    const actor = await requireKnowledgeAccess(request);
    const comparison = await getLatestKnowledgeSegmentCandidateComparison(
      actor,
      sourceId,
      candidateId,
      getDb(),
    );
    return Response.json({ comparison });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
