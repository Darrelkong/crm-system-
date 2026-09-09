import { getRequestMeta } from "@/lib/auth/cookies";
import {
  approveAndPublishKnowledgeReview,
  assignKnowledgeReview,
  getKnowledgeReviewRequest,
  requestKnowledgeReviewChanges,
  withdrawKnowledgeReview,
} from "@/lib/knowledge/review-service";
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
    return Response.json({
      review: await getKnowledgeReviewRequest(actor, id),
    });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await requireKnowledgeAccess(request);
    const input = (await request.json()) as Record<string, unknown>;
    const meta = getRequestMeta(request);
    const action = input.action;
    if (action === "assign") {
      return Response.json({
        review: await assignKnowledgeReview(
          actor,
          id,
          input.reviewerUserId,
          meta,
        ),
      });
    }
    if (action === "request_changes") {
      return Response.json({
        review: await requestKnowledgeReviewChanges(
          actor,
          id,
          input.reviewNote,
          meta,
        ),
      });
    }
    if (action === "approve_publish") {
      return Response.json({
        review: await approveAndPublishKnowledgeReview(actor, id, meta),
      });
    }
    if (action === "withdraw") {
      return Response.json({
        review: await withdrawKnowledgeReview(actor, id, meta),
      });
    }
    return Response.json(
      { error: "审核操作无效", errorCode: "KNOWLEDGE_REVIEW_INVALID" },
      { status: 400 },
    );
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
