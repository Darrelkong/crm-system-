import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { buildOrganizerDraftFromOrganization } from "@/lib/knowledge/knowledge-ingest-organizer-draft";
import { getKnowledgeSource } from "@/lib/knowledge/source-service";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type OrganizerDraftRequestBody = {
  manualRequestedProjectCode?: string | null;
  manualRequestedProjectOverride?: boolean;
  manualCategoryId?: string | null;
  manualCategoryOverride?: boolean;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await requireKnowledgeAccess(request);
    const source = await getKnowledgeSource(actor, id);
    let body: OrganizerDraftRequestBody = {};
    try {
      body = (await request.json()) as OrganizerDraftRequestBody;
    } catch {
      throw new KnowledgeServiceError(
        KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
        "Invalid organizer draft request",
        400,
      );
    }

    const draft = await buildOrganizerDraftFromOrganization(source, {
      manualRequestedProjectCode: body.manualRequestedProjectCode ?? null,
      manualRequestedProjectOverride:
        body.manualRequestedProjectOverride === true,
      manualCategoryId: body.manualCategoryId ?? null,
      manualCategoryOverride: body.manualCategoryOverride === true,
    });

    return Response.json({ draft });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
