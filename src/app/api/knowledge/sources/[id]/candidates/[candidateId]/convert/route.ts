import { getRequestMeta } from "@/lib/auth/cookies";
import { convertKnowledgeSegmentCandidateToDraft } from "@/lib/knowledge/knowledge-segment-candidate-convert-service";
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
      categoryId?: string;
      visibility?: string;
      changeNote?: string;
    };
    const article = await convertKnowledgeSegmentCandidateToDraft(
      actor,
      sourceId,
      candidateId,
      {
        title: body.title,
        summary: body.summary,
        body: body.body,
        categoryId: body.categoryId,
        visibility: body.visibility,
        changeNote: body.changeNote,
      },
      getRequestMeta(request),
      getDb(),
    );
    return Response.json({ article });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
