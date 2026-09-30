import { getDb } from "@/lib/db";
import {
  listKnowledgeSegmentCandidates,
  materializeKnowledgeSegmentCandidatesForSource,
} from "@/lib/knowledge/knowledge-segment-candidate-service";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireKnowledgeAccess(request);
    const { id: sourceId } = await context.params;
    const includeSuperseded =
      new URL(request.url).searchParams.get("includeSuperseded") === "1";
    const candidates = await listKnowledgeSegmentCandidates(actor, sourceId, getDb(), {
      includeSuperseded,
    });
    return Response.json({ candidates });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireKnowledgeAccess(request);
    const { id: sourceId } = await context.params;
    const candidates = await materializeKnowledgeSegmentCandidatesForSource(
      actor,
      sourceId,
    );
    return Response.json({ candidates });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
