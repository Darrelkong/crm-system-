import {
  createBusinessCategoryMappingAsAdmin,
  listBusinessCategoryMappingAdminGroups,
  listBusinessCategoryMappingAdminRows,
} from "@/lib/knowledge/knowledge-business-category-mapping-admin-service";
import type { RequestedProjectLocale } from "@/lib/constants/requested-projects";
import {
  knowledgeErrorResponse,
  requireKnowledgeAdmin,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

function parseLocale(value: string | null): RequestedProjectLocale {
  if (value === "zh-Hant" || value === "en" || value === "zh-Hans") {
    return value;
  }
  return "zh-Hans";
}

export async function GET(request: Request) {
  try {
    await requireKnowledgeAdmin(request);
    const locale = parseLocale(
      new URL(request.url).searchParams.get("locale"),
    );
    const rows = await listBusinessCategoryMappingAdminRows(locale);
    const groups = listBusinessCategoryMappingAdminGroups(locale);
    return Response.json({ rows, groups });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}

type CreateBody = {
  requestedProjectCode?: string;
  knowledgeCategoryId?: string;
};

export async function POST(request: Request) {
  try {
    const actor = await requireKnowledgeAdmin(request);
    const body = (await request.json()) as CreateBody;
    const requestedProjectCode = body.requestedProjectCode?.trim() ?? "";
    const knowledgeCategoryId = body.knowledgeCategoryId?.trim() ?? "";
    if (!requestedProjectCode || !knowledgeCategoryId) {
      return Response.json(
        { error: "缺少关联业务或知识库分类", errorCode: "invalid_request" },
        { status: 400 },
      );
    }
    const mapping = await createBusinessCategoryMappingAsAdmin({
      requestedProjectCode,
      knowledgeCategoryId,
      actorUserId: actor.user.id,
    });
    return Response.json({ mapping }, { status: 201 });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
