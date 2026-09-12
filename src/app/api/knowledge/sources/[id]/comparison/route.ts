import { getLatestKnowledgeComparison } from "@/lib/knowledge/comparison-service";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await requireKnowledgeAccess(request);
    const comparison = await getLatestKnowledgeComparison(actor, id);
    return Response.json({ comparison });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
