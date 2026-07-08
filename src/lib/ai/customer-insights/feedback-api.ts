import type { User } from "../../../../drizzle/schema/users";
import type { Database } from "@/lib/db";
import { getCustomerById } from "@/lib/customers/queries";
import { AuthError } from "@/lib/permissions/auth";
import { getCustomerAiInsightByCustomerId } from "@/lib/ai/customer-insights/service";
import {
  buildAiInsightFeedbackAuditMetadata,
  getAiInsightFeedbackForInsight,
  isValidAiInsightFeedbackRating,
  normalizeAiInsightFeedbackComment,
  normalizeAiInsightFeedbackReasonTags,
  type AiInsightFeedbackInput,
  type AiInsightFeedbackView,
  upsertAiInsightFeedbackRow,
} from "@/lib/ai/customer-insights/feedback";

export type AiInsightFeedbackApiErrorCode =
  | "CUSTOMER_NOT_FOUND"
  | "INSIGHT_NOT_FOUND"
  | "INSIGHT_NOT_READY"
  | "INVALID_RATING"
  | "INVALID_REASON_TAGS"
  | "INVALID_COMMENT"
  | "INSIGHT_VERSION_MISMATCH";

export class AiInsightFeedbackApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errorCode: AiInsightFeedbackApiErrorCode,
  ) {
    super(message);
    this.name = "AiInsightFeedbackApiError";
  }
}

export function assertAdminForAiInsightFeedback(user: User): void {
  if (user.role !== "admin") {
    throw new AuthError(
      403,
      "需要管理员权限",
      "permission.denied.admin_required",
    );
  }
}

export function toAiInsightFeedbackApiErrorResponse(error: AiInsightFeedbackApiError): Response {
  return Response.json(
    {
      error: error.message,
      errorCode: error.errorCode,
    },
    { status: error.status },
  );
}

export async function getCustomerAiInsightFeedbackForAdmin(
  db: Database,
  user: User,
  customerId: string,
): Promise<{ feedback: AiInsightFeedbackView | null }> {
  assertAdminForAiInsightFeedback(user);

  const customer = await getCustomerById(customerId);
  if (!customer) {
    throw new AiInsightFeedbackApiError(404, "客户不存在", "CUSTOMER_NOT_FOUND");
  }

  const insight = await getCustomerAiInsightByCustomerId(db, customerId);
  if (!insight || insight.status !== "ready") {
    return { feedback: null };
  }

  const feedback = await getAiInsightFeedbackForInsight(
    db,
    customerId,
    insight.generatedAt,
  );
  return { feedback };
}

export async function upsertCustomerAiInsightFeedbackForAdmin(
  db: Database,
  user: User,
  customerId: string,
  input: AiInsightFeedbackInput,
): Promise<{ feedback: AiInsightFeedbackView; created: boolean }> {
  assertAdminForAiInsightFeedback(user);

  const customer = await getCustomerById(customerId);
  if (!customer) {
    throw new AiInsightFeedbackApiError(404, "客户不存在", "CUSTOMER_NOT_FOUND");
  }

  const insight = await getCustomerAiInsightByCustomerId(db, customerId);
  if (!insight) {
    throw new AiInsightFeedbackApiError(422, "暂无 AI 分析", "INSIGHT_NOT_FOUND");
  }
  if (insight.status !== "ready") {
    throw new AiInsightFeedbackApiError(422, "当前 AI 分析不可评分", "INSIGHT_NOT_READY");
  }

  if (typeof input.insightGeneratedAt !== "string" || input.insightGeneratedAt.trim() === "") {
    throw new AiInsightFeedbackApiError(409, "分析版本已变更，请刷新后重试", "INSIGHT_VERSION_MISMATCH");
  }
  if (input.insightGeneratedAt !== insight.generatedAt) {
    throw new AiInsightFeedbackApiError(409, "分析版本已变更，请刷新后重试", "INSIGHT_VERSION_MISMATCH");
  }

  if (!isValidAiInsightFeedbackRating(input.rating)) {
    throw new AiInsightFeedbackApiError(400, "评分必须为 1 至 5", "INVALID_RATING");
  }

  const reasonTags = normalizeAiInsightFeedbackReasonTags(input.reasonTags);
  if (reasonTags === null) {
    throw new AiInsightFeedbackApiError(400, "低分原因无效", "INVALID_REASON_TAGS");
  }

  const comment = normalizeAiInsightFeedbackComment(input.comment);
  if (
    input.comment !== undefined &&
    input.comment !== null &&
    input.comment !== "" &&
    comment === null
  ) {
    throw new AiInsightFeedbackApiError(400, "补充备注过长或格式无效", "INVALID_COMMENT");
  }

  const existing = await getAiInsightFeedbackForInsight(
    db,
    customerId,
    insight.generatedAt,
  );

  return upsertAiInsightFeedbackRow(db, {
    customerId,
    aiInsightId: insight.id,
    insightGeneratedAt: insight.generatedAt,
    model: insight.model,
    promptVersion: insight.promptVersion,
    sourceHash: insight.sourceHash,
    rating: input.rating,
    reasonTags,
    comment,
    actorId: user.id,
    existingId: existing?.id,
  });
}

export { buildAiInsightFeedbackAuditMetadata };
