import { getRequestMeta } from "@/lib/auth/cookies";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  archiveKnowledgeSource,
  getKnowledgeSource,
  restoreKnowledgeSource,
} from "@/lib/knowledge/source-service";
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
    return Response.json({ source: await getKnowledgeSource(actor, id) });
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
    if (input.archive === true && input.restore === true) {
      throw new KnowledgeServiceError(
        KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
        "Conflicting source lifecycle action",
        400,
      );
    }
    if (input.archive === true || input.restore === true) {
      if (typeof input.expectedUpdatedAt !== "string") {
        throw new KnowledgeServiceError(
          KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
          "Source version metadata missing",
          409,
        );
      }
      const source =
        input.restore === true
          ? await restoreKnowledgeSource(
              actor,
              id,
              input.expectedUpdatedAt,
              { ipAddress, userAgent },
            )
          : await archiveKnowledgeSource(
              actor,
              id,
              input.expectedUpdatedAt,
              { ipAddress, userAgent },
            );
      return Response.json({ source });
    }
    throw new KnowledgeServiceError(
      KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
      "Unsupported source action",
      400,
    );
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
