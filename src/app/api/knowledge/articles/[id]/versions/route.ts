import {
  getKnowledgeArticleVersion,
  listKnowledgeArticleVersions,
} from "@/lib/knowledge/core-service";
import { getRequestMeta } from "@/lib/auth/cookies";
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
    const version = new URL(request.url).searchParams.get("version");
    if (version != null) {
      const parsed = Number(version);
      const { ipAddress, userAgent } = getRequestMeta(request);
      return Response.json({
        version: await getKnowledgeArticleVersion(
          actor,
          id,
          parsed,
          { ipAddress, userAgent },
        ),
      });
    }
    return Response.json({
      versions: await listKnowledgeArticleVersions(actor, id),
    });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
