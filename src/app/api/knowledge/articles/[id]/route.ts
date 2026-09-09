import { getRequestMeta } from "@/lib/auth/cookies";
import {
  archiveKnowledgeArticle,
  getKnowledgeArticle,
  updateKnowledgeArticle,
  type KnowledgeArticleInput,
} from "@/lib/knowledge/core-service";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await requireKnowledgeAccess(request);
    return Response.json({ article: await getKnowledgeArticle(actor, id) });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await requireKnowledgeAccess(request);
    const input = (await request.json()) as Record<string, unknown>;
    const { ipAddress, userAgent } = getRequestMeta(request);
    if (input.archive === true) {
      if (typeof input.expectedUpdatedAt !== "string") {
        throw new KnowledgeServiceError(
          "KNOWLEDGE_ARTICLE_CONFLICT",
          "文章版本资料缺失",
          409,
        );
      }
      const article = await archiveKnowledgeArticle(
        actor,
        id,
        input.expectedUpdatedAt,
        { ipAddress, userAgent },
      );
      return Response.json({ article });
    }
    if ("status" in input || "publish" in input) {
      throw new KnowledgeServiceError(
        "KNOWLEDGE_ARTICLE_INVALID",
        "Package 2 不提供发布操作",
        400,
      );
    }
    const article = await updateKnowledgeArticle(
      actor,
      id,
      input as KnowledgeArticleInput,
      { ipAddress, userAgent },
    );
    return Response.json({ article });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
