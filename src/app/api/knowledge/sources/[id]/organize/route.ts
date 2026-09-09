import { getRequestMeta } from "@/lib/auth/cookies";
import { organizeKnowledgeSource } from "@/lib/knowledge/ai-organizer-service";
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
    const source = await organizeKnowledgeSource(
      actor,
      id,
      getRequestMeta(request),
    );
    return Response.json({ source });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
