import { getRequestMeta } from "@/lib/auth/cookies";
import { retryKnowledgeSourceExtraction } from "@/lib/knowledge/source-service";
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
    const body = (await request.json().catch(() => ({}))) as {
      confirmReplaceCompleted?: unknown;
    };
    const source = await retryKnowledgeSourceExtraction(
      actor,
      id,
      getRequestMeta(request),
      undefined,
      undefined,
      {
        confirmReplaceCompleted: body.confirmReplaceCompleted === true,
      },
    );
    return Response.json({ source });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
