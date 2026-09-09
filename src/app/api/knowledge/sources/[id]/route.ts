import { getKnowledgeSource } from "@/lib/knowledge/source-service";
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
    return Response.json({ source: await getKnowledgeSource(actor, id) });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
