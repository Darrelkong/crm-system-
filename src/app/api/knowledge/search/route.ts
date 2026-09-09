import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";
import { searchPublishedKnowledge } from "@/lib/knowledge/published-retrieval";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireKnowledgeAccess(request);
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json({
      query,
      results: await searchPublishedKnowledge(context, query),
    });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
