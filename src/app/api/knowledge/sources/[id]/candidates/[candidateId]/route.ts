import { getDb } from "@/lib/db";
import { requireKnowledgeAccess } from "@/lib/permissions/knowledge";
import { handleCandidatePatch } from "@/lib/knowledge/knowledge-candidate-patch";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; candidateId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  return handleCandidatePatch(request, context.params, requireKnowledgeAccess, getDb);
}
