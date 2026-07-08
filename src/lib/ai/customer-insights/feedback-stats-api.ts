import type { User } from "../../../../drizzle/schema/users";
import type { Database } from "@/lib/db";
import { assertAdminForAiInsightFeedback } from "@/lib/ai/customer-insights/feedback-api";
import {
  getAiInsightFeedbackStats,
  type AiInsightFeedbackStatsResponse,
} from "@/lib/ai/customer-insights/feedback-stats";

export async function getAiInsightFeedbackStatsForAdmin(
  db: Database,
  user: User,
): Promise<AiInsightFeedbackStatsResponse> {
  assertAdminForAiInsightFeedback(user);
  return getAiInsightFeedbackStats(db);
}
