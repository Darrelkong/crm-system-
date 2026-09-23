import { getRequestMeta } from "@/lib/auth/cookies";
import {
  processKnowledgeSourceAnalysisRun,
  scheduleKnowledgeSourceAnalysisProcessing,
  startKnowledgeSourceAnalysis,
} from "@/lib/knowledge/smart-ingest-analysis-service";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireKnowledgeAccess(request);
    const { id: sourceId } = await context.params;
    const meta = getRequestMeta(request);
    const { runId, status } = await startKnowledgeSourceAnalysis(
      session,
      sourceId,
      meta,
    );

    try {
      const { ctx } = getCloudflareContext();
      ctx.waitUntil(processKnowledgeSourceAnalysisRun(runId));
    } catch {
      scheduleKnowledgeSourceAnalysisProcessing(runId);
    }

    return Response.json({ runId, status }, { status: 202 });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
