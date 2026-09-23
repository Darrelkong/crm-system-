import { getKnowledgeSourceAnalysisRun } from "@/lib/knowledge/smart-ingest-analysis-service";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; runId: string }> },
) {
  try {
    const session = await requireKnowledgeAccess(request);
    const { id: sourceId, runId } = await context.params;
    const run = await getKnowledgeSourceAnalysisRun(session, sourceId, runId);
    return Response.json({ run });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
