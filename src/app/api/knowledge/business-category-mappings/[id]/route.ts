import { updateBusinessCategoryMappingAsAdmin } from "@/lib/knowledge/knowledge-business-category-mapping-admin-service";
import {
  knowledgeErrorResponse,
  requireKnowledgeAdmin,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type PatchBody = {
  knowledgeCategoryId?: string;
  isActive?: boolean;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireKnowledgeAdmin(request);
    const { id } = await context.params;
    const body = (await request.json()) as PatchBody;
    if (
      body.knowledgeCategoryId === undefined &&
      body.isActive === undefined
    ) {
      return Response.json(
        { error: "没有可更新的字段", errorCode: "invalid_request" },
        { status: 400 },
      );
    }
    const mapping = await updateBusinessCategoryMappingAsAdmin(id, {
      knowledgeCategoryId: body.knowledgeCategoryId,
      isActive: body.isActive,
      actorUserId: actor.user.id,
    });
    return Response.json({ mapping });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
