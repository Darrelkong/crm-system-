import { getRequestMeta } from "@/lib/auth/cookies";
import {
  listKnowledgeReviewRequests,
  submitKnowledgeReview,
  type KnowledgeReviewListView,
} from "@/lib/knowledge/review-service";
import {
  knowledgeErrorResponse,
  requireKnowledgeAccess,
} from "@/lib/permissions/knowledge";

export const dynamic = "force-dynamic";

function parseView(value: string | null, role: string | null): KnowledgeReviewListView {
  if (value === "mine" || value === "history") return value;
  return role === "reviewer" || role === "knowledge_admin" ? "pending" : "mine";
}

export async function GET(request: Request) {
  try {
    const context = await requireKnowledgeAccess(request);
    const view = parseView(
      new URL(request.url).searchParams.get("view"),
      context.role,
    );
    return Response.json({
      view,
      reviews: await listKnowledgeReviewRequests(context, view),
    });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireKnowledgeAccess(request);
    const input = (await request.json()) as Record<string, unknown>;
    const review = await submitKnowledgeReview(
      context,
      {
        articleId: input.articleId,
        submissionNote: input.submissionNote,
        dueAt: input.dueAt,
      },
      getRequestMeta(request),
    );
    return Response.json({ review }, { status: 201 });
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
