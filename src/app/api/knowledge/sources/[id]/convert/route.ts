import { getRequestMeta } from "@/lib/auth/cookies";
import { convertKnowledgeSourceToDraft } from "@/lib/knowledge/source-service";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await requireKnowledgeAccess(request);
    const input = (await request.json()) as Record<string, unknown>;
    const article = await convertKnowledgeSourceToDraft(
      actor,
      id,
      {
        title: input.title,
        summary: input.summary,
        body: input.body,
        categoryId: input.categoryId,
        visibility: input.visibility,
        changeNote: input.changeNote,
      },
      getRequestMeta(request),
    );
    return Response.json({ article }, { status: 201 });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
