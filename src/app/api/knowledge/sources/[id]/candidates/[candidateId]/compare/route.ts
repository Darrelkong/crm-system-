import { getRequestMeta } from "@/lib/auth/cookies";
import { compareKnowledgeSegmentCandidate } from "@/lib/knowledge/comparison-service";
import { getDb } from "@/lib/db";
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
    const body = (await request.json()) as {
      title?: string;
      summary?: string;
      body?: string;
    };
    const comparison = await compareKnowledgeSegmentCandidate(
      actor,
      sourceId,
      candidateId,
      {
        title: body.title ?? "",
        summary: body.summary ?? "",
        body: body.body ?? "",
      },
      getRequestMeta(request),
      getDb(),
    );
    return Response.json({ comparison });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
