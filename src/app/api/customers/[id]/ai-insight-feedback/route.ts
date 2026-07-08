export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import { getRequestMeta } from "@/lib/auth/cookies";
import { writeAuditLog } from "@/lib/audit/audit-log";
import {
  AiInsightFeedbackApiError,
  buildAiInsightFeedbackAuditMetadata,
  getCustomerAiInsightFeedbackForAdmin,
  toAiInsightFeedbackApiErrorResponse,
  upsertCustomerAiInsightFeedbackForAdmin,
} from "@/lib/ai/customer-insights/feedback-api";
import type { AiInsightFeedbackInput } from "@/lib/ai/customer-insights/feedback";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const db = getDb();

    const result = await getCustomerAiInsightFeedbackForAdmin(db, user, id);
    return Response.json(result);
  } catch (error) {
    if (error instanceof AiInsightFeedbackApiError) {
      return toAiInsightFeedbackApiErrorResponse(error);
    }
    return authErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const db = getDb();
    const meta = getRequestMeta(request);
    const body = (await request.json()) as AiInsightFeedbackInput;

    const result = await upsertCustomerAiInsightFeedbackForAdmin(db, user, id, body);

    await writeAuditLog(
      {
        userId: user.id,
        action: result.created
          ? "customer.ai_insight.feedback.created"
          : "customer.ai_insight.feedback.updated",
        entityType: "customer",
        entityId: id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: buildAiInsightFeedbackAuditMetadata(result.feedback),
      },
      db,
    );

    return Response.json({
      feedback: result.feedback,
      created: result.created,
    });
  } catch (error) {
    if (error instanceof AiInsightFeedbackApiError) {
      return toAiInsightFeedbackApiErrorResponse(error);
    }
    return authErrorResponse(error);
  }
}
