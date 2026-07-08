export const dynamic = "force-dynamic";

import { getAiInsightFeedbackStatsForAdmin } from "@/lib/ai/customer-insights/feedback-stats-api";
import { getDb } from "@/lib/db";
import { authErrorResponse, requireAdmin } from "@/lib/permissions/auth";

export async function GET(request: Request) {
  try {
    const user = await requireAdmin(request);
    const db = getDb();
    const result = await getAiInsightFeedbackStatsForAdmin(db, user);
    return Response.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
