import { getRequestMeta } from "@/lib/auth/cookies";
import { compareKnowledgeSource } from "@/lib/knowledge/comparison-service";
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
    const comparison = await compareKnowledgeSource(
      actor,
      id,
      getRequestMeta(request),
    );
    return Response.json({ comparison });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
