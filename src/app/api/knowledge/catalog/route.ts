import { getKnowledgeCatalog } from "@/lib/knowledge/core-service";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireKnowledgeAccess(request);
    return Response.json({ catalog: await getKnowledgeCatalog(context) });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
