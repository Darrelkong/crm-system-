import type { Database } from "@/lib/db";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import { knowledgeErrorResponse } from "@/lib/permissions/knowledge";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { updateCandidateManualClassification } from "@/lib/knowledge/knowledge-segment-candidate-classification";

/** HTTP adapter shared by the route and isolated endpoint regression tests. */
export async function handleCandidatePatch(
  request: Request,
  params: Promise<{ id: string; candidateId: string }>,
  authorize: (request: Request) => Promise<KnowledgeSessionContext>,
  database: () => Database,
): Promise<Response> {
  try {
    const actor = await authorize(request);
    const { id, candidateId } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new KnowledgeServiceError(KNOWLEDGE_ERROR_CODES.SOURCE_INVALID, "主题分类更新格式无效", 400);
    }
    const candidate = await updateCandidateManualClassification(actor, id, candidateId, body, database());
    return Response.json({ candidate });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
