import { z } from "zod";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  buildCandidateOrganizerDraft,
  buildCandidateOrganizerDraftPayload,
} from "@/lib/knowledge/knowledge-segment-candidate-organizer-draft";
import { syncCandidateCategoryFromOrganizerDraft } from "@/lib/knowledge/knowledge-segment-candidate-draft-sync";
import {
  getActiveSegmentCandidate,
} from "@/lib/knowledge/knowledge-segment-candidate-organizer-service";
import {
  updateCandidateManualClassification,
  parseCandidateManualUpdate,
} from "@/lib/knowledge/knowledge-segment-candidate-classification";
import { getDb } from "@/lib/db";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; candidateId: string }>;
};

const requestSchema = z.object({
  manualRequestedProjectCode: z.string().nullable().optional(),
  manualRequestedProjectOverride: z.boolean().optional(),
  manualCategoryId: z.string().nullable().optional(),
  manualCategoryOverride: z.boolean().optional(),
  adoptCategorySuggestion: z.boolean().optional(),
}).strict();
type OrganizerDraftRequestBody = z.infer<typeof requestSchema>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: sourceId, candidateId } = await context.params;
    const actor = await requireKnowledgeAccess(request);
    const db = getDb();
    let body: OrganizerDraftRequestBody = {};
    try {
      body = requestSchema.parse(await request.json());
    } catch {
      throw new KnowledgeServiceError(
        KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
        "Invalid organizer draft request",
        400,
      );
    }

    let candidate = await getActiveSegmentCandidate(
      actor,
      sourceId,
      candidateId,
      db,
    );

    const manual: { requestedProjectCode?: string | null; knowledgeCategoryId?: string | null } = {};
    if (body.manualRequestedProjectOverride === true) manual.requestedProjectCode = body.manualRequestedProjectCode ?? null;
    if (body.manualCategoryOverride === true) manual.knowledgeCategoryId = body.manualCategoryId ?? null;
    if (Object.keys(manual).length) parseCandidateManualUpdate(manual);
    if (body.adoptCategorySuggestion === true) {
      const preview = await buildCandidateOrganizerDraft(actor, sourceId, candidate, body, db);
      if (preview.suggestedCategoryId) manual.knowledgeCategoryId = preview.suggestedCategoryId;
    }
    if (Object.keys(manual).length) {
      candidate = await updateCandidateManualClassification(
        actor, sourceId, candidateId, manual, db, candidate.updatedAt,
      );
    }

    const payload = await buildCandidateOrganizerDraftPayload(
      actor,
      sourceId,
      candidate,
      {
        manualRequestedProjectCode: body.manualRequestedProjectCode,
        manualRequestedProjectOverride: body.manualRequestedProjectOverride,
        manualCategoryId: body.manualCategoryId,
        manualCategoryOverride: body.manualCategoryOverride,
      },
      db,
    );

    await syncCandidateCategoryFromOrganizerDraft(
      candidate,
      payload.draft,
      db,
      payload.organizationRunId,
    );
    const refreshed = await getActiveSegmentCandidate(
      actor,
      sourceId,
      candidateId,
      db,
    );

    return Response.json({
      draft: payload.draft,
      organizationRunId: payload.organizationRunId,
      organizationUsable: payload.organizationUsable,
      candidate: refreshed,
    });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
