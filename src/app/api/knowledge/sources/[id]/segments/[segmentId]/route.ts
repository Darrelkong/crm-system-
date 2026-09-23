import { getRequestMeta } from "@/lib/auth/cookies";
import { updateKnowledgeSourceSegmentStatus } from "@/lib/knowledge/smart-ingest-analysis-service";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; segmentId: string }> },
) {
  try {
    const session = await requireKnowledgeAccess(request);
    const { id: sourceId, segmentId } = await context.params;
    const body = (await request.json()) as { status?: string };
    if (body.status !== "proposed" && body.status !== "rejected") {
      return Response.json({ error: "Invalid segment status" }, { status: 400 });
    }
    const meta = getRequestMeta(request);
    const segment = await updateKnowledgeSourceSegmentStatus(
      session,
      sourceId,
      segmentId,
      body.status,
      meta,
    );
    return Response.json({ segment });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
