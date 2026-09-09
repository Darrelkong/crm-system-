import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";
import { askKnowledge } from "@/lib/knowledge/qa-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await requireKnowledgeAccess(request);
    const input = (await request.json()) as Record<string, unknown>;
    return Response.json({
      answer: await askKnowledge(context, input.question),
    });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
