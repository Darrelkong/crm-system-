import { getRequestMeta } from "@/lib/auth/cookies";
import {
  createKnowledgeArticle,
  listKnowledgeArticles,
  type KnowledgeArticleInput,
} from "@/lib/knowledge/core-service";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireKnowledgeAccess(request);
    const categoryId = new URL(request.url).searchParams.get("categoryId");
    const articles = await listKnowledgeArticles(
      context,
      { categoryId, includeArchived: context.role === "knowledge_admin" },
    );
    return Response.json({ articles });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireKnowledgeAccess(request);
    const input = (await request.json()) as Record<string, unknown>;
    const { ipAddress, userAgent } = getRequestMeta(request);
    const article = await createKnowledgeArticle(
      context,
      input as KnowledgeArticleInput,
      { ipAddress, userAgent },
    );
    return Response.json({ article }, { status: 201 });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
