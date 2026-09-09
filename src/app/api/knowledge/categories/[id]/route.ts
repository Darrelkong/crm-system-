import { getRequestMeta } from "@/lib/auth/cookies";
import {
  deleteKnowledgeCategory,
  updateKnowledgeCategory,
  type KnowledgeCategoryInput,
} from "@/lib/knowledge/core-service";
import {
  knowledgeErrorResponse,
  requireKnowledgeAdmin,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await requireKnowledgeAdmin(request);
    const input = (await request.json()) as Record<string, unknown>;
    const { ipAddress, userAgent } = getRequestMeta(request);
    const category = await updateKnowledgeCategory(
      actor,
      id,
      input as KnowledgeCategoryInput & {
        expectedUpdatedAt?: unknown;
        isActive?: unknown;
      },
      { ipAddress, userAgent },
    );
    return Response.json({ category });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await requireKnowledgeAdmin(request);
    await deleteKnowledgeCategory(actor, id);
    return Response.json({ ok: true });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
