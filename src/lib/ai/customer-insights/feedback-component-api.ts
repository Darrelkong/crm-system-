/**
 * Phase 5D-2 Component Feedback API (GET/PUT orchestration).
 * No provider calls, quota, cooldown, or Insight/Customer mutations.
 */

import type { User } from "../../../../drizzle/schema/users";
import type { Database } from "@/lib/db";
import { getCustomerById } from "@/lib/customers/queries";
import {
  PermissionError,
  assertCanViewCustomerAiInsight,
  resolveCustomerAccessOptions,
} from "@/lib/permissions/customers";
import { getCustomerAiInsightByCustomerId } from "@/lib/ai/customer-insights/service";
import { getEffectiveAiSettings } from "@/lib/settings/ai-effective";
import { buildAiInsightGenerationKey } from "@/lib/ai/customer-insights/feedback-generation-key";
import {
  resolveComponentFeedbackEligibility,
  isComponentTargetEligible,
  type ComponentFeedbackEligibility,
} from "@/lib/ai/customer-insights/feedback-component-eligibility";
import { resolveComponentFeedbackSnapshots } from "@/lib/ai/customer-insights/feedback-component-snapshot";
import type { ComponentFeedbackPutInput } from "@/lib/ai/customer-insights/feedback-component-request";
import {
  listFeedbackForGeneration,
  upsertActorComponentFeedback,
  FeedbackRepositoryError,
  type ComponentFeedbackView,
} from "@/lib/ai/customer-insights/feedback-repository";
import type {
  AiInsightFeedbackComponentTarget,
  AiInsightFeedbackComponentTag,
  AiInsightFeedbackRatingCode,
} from "@/lib/ai/customer-insights/feedback-contract";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";

export type ComponentFeedbackApiErrorCode =
  | "CUSTOMER_NOT_FOUND"
  | "AI_FEEDBACK_INSIGHT_NOT_FOUND"
  | "AI_FEEDBACK_INSIGHT_NOT_READY"
  | "AI_FEEDBACK_GENERATION_MISMATCH"
  | "AI_FEEDBACK_INVALID_REQUEST"
  | "AI_FEEDBACK_INVALID_TARGET"
  | "AI_FEEDBACK_TARGET_NOT_ALLOWED"
  | "AI_FEEDBACK_TARGET_NOT_ELIGIBLE"
  | "AI_FEEDBACK_INVALID_RATING"
  | "AI_FEEDBACK_INVALID_TAGS"
  | "AI_FEEDBACK_COMMENT_NOT_ALLOWED"
  | "AI_FEEDBACK_BODY_TOO_LARGE"
  | "AI_FEEDBACK_SNAPSHOT_UNAVAILABLE"
  | "AI_FEEDBACK_WRITE_FAILED";

export class ComponentFeedbackApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errorCode: ComponentFeedbackApiErrorCode,
  ) {
    super(message);
    this.name = "ComponentFeedbackApiError";
  }
}

export function toComponentFeedbackApiErrorResponse(
  error: ComponentFeedbackApiError,
): Response {
  return Response.json(
    {
      error: error.message,
      errorCode: error.errorCode,
    },
    { status: error.status },
  );
}

export type ComponentFeedbackItemResponse = {
  rating: AiInsightFeedbackRatingCode;
  tags: AiInsightFeedbackComponentTag[];
  updatedAt: string;
};

export type ComponentFeedbackSafeResponse = {
  ok: true;
  generation: {
    insightGeneratedAt: string;
    sourceHash: string;
  } | null;
  eligibility: ComponentFeedbackEligibility;
  feedback: {
    baseDeep: ComponentFeedbackItemResponse | null;
    phase2: ComponentFeedbackItemResponse | null;
    suggestedMessage: ComponentFeedbackItemResponse | null;
  };
};

const EMPTY_ELIGIBILITY: ComponentFeedbackEligibility = {
  baseDeep: false,
  phase2: false,
  suggestedMessage: false,
};

function toSafeItem(
  row: ComponentFeedbackView | null | undefined,
): ComponentFeedbackItemResponse | null {
  if (!row) return null;
  return {
    rating: row.ratingCode,
    tags: row.reasonTags,
    updatedAt: row.updatedAt,
  };
}

async function assertCustomerViewPermission(
  db: Database,
  user: User,
  customerId: string,
) {
  const customer = await getCustomerById(customerId);
  if (!customer) {
    throw new ComponentFeedbackApiError(
      404,
      "客户不存在",
      "CUSTOMER_NOT_FOUND",
    );
  }

  const accessOptions = await resolveCustomerAccessOptions(db, user, customerId);
  try {
    assertCanViewCustomerAiInsight(user, customer, accessOptions);
  } catch (err) {
    if (err instanceof PermissionError) {
      throw err;
    }
    throw err;
  }

  return customer;
}

function buildUnavailableResponse(): ComponentFeedbackSafeResponse {
  return {
    ok: true,
    generation: null,
    eligibility: { ...EMPTY_ELIGIBILITY },
    feedback: {
      baseDeep: null,
      phase2: null,
      suggestedMessage: null,
    },
  };
}

/** Settings load failure → treat as null (message ineligible; never default true). */
async function loadSettingsForEligibility(
  db: Database,
): Promise<Pick<EffectiveAiSettings, "aiShowDraftMessage"> | null> {
  try {
    return await getEffectiveAiSettings(db);
  } catch {
    return null;
  }
}

/** Exact deep keys allowed in GET/PUT safe responses (for privacy tests). */
export function collectComponentFeedbackResponseDeepKeys(
  value: unknown,
  prefix = "",
): string[] {
  if (value === null || typeof value !== "object") {
    return prefix ? [prefix] : [];
  }
  if (Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  const keys: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      keys.push(...collectComponentFeedbackResponseDeepKeys(child, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

export const COMPONENT_FEEDBACK_SAFE_RESPONSE_KEY_PATHS = [
  "ok",
  "generation",
  "generation.insightGeneratedAt",
  "generation.sourceHash",
  "eligibility.baseDeep",
  "eligibility.phase2",
  "eligibility.suggestedMessage",
  "feedback.baseDeep",
  "feedback.baseDeep.rating",
  "feedback.baseDeep.tags",
  "feedback.baseDeep.updatedAt",
  "feedback.phase2",
  "feedback.phase2.rating",
  "feedback.phase2.tags",
  "feedback.phase2.updatedAt",
  "feedback.suggestedMessage",
  "feedback.suggestedMessage.rating",
  "feedback.suggestedMessage.tags",
  "feedback.suggestedMessage.updatedAt",
] as const;

export function assertComponentFeedbackSafeResponseKeys(
  response: ComponentFeedbackSafeResponse,
): void {
  const keys = collectComponentFeedbackResponseDeepKeys(response);
  for (const key of keys) {
    if (
      !(COMPONENT_FEEDBACK_SAFE_RESPONSE_KEY_PATHS as readonly string[]).includes(
        key,
      )
    ) {
      throw new Error(`Unexpected response key path: ${key}`);
    }
  }
}

export async function getComponentFeedbackForActor(
  db: Database,
  user: User,
  customerId: string,
): Promise<ComponentFeedbackSafeResponse> {
  await assertCustomerViewPermission(db, user, customerId);

  const insight = await getCustomerAiInsightByCustomerId(db, customerId);
  const settings = await loadSettingsForEligibility(db);
  const eligibility = resolveComponentFeedbackEligibility(insight, settings);

  if (!insight || insight.status !== "ready" || !eligibility.baseDeep) {
    return buildUnavailableResponse();
  }

  const generationKey = buildAiInsightGenerationKey({
    aiInsightId: insight.id,
    insightGeneratedAt: insight.generatedAt,
    sourceHash: insight.sourceHash,
  });

  const rows = await listFeedbackForGeneration(db, generationKey);
  const actorRows = rows.filter((row) => row.createdBy === user.id);

  const byTarget = new Map<AiInsightFeedbackComponentTarget, ComponentFeedbackView>();
  for (const row of actorRows) {
    byTarget.set(row.feedbackTarget, row);
  }

  return {
    ok: true,
    generation: {
      insightGeneratedAt: insight.generatedAt,
      sourceHash: insight.sourceHash,
    },
    eligibility,
    feedback: {
      baseDeep: toSafeItem(byTarget.get("base_deep")),
      phase2: toSafeItem(byTarget.get("phase2")),
      suggestedMessage: toSafeItem(byTarget.get("suggested_message")),
    },
  };
}

export async function putComponentFeedbackForActor(
  db: Database,
  user: User,
  customerId: string,
  input: ComponentFeedbackPutInput,
): Promise<{
  response: ComponentFeedbackSafeResponse;
  feedback: ComponentFeedbackView;
  created: boolean;
}> {
  await assertCustomerViewPermission(db, user, customerId);

  const insight = await getCustomerAiInsightByCustomerId(db, customerId);
  if (!insight) {
    throw new ComponentFeedbackApiError(
      404,
      "暂无 AI 分析",
      "AI_FEEDBACK_INSIGHT_NOT_FOUND",
    );
  }
  if (insight.status !== "ready") {
    throw new ComponentFeedbackApiError(
      422,
      "当前 AI 分析不可评价",
      "AI_FEEDBACK_INSIGHT_NOT_READY",
    );
  }

  if (
    input.insightGeneratedAt !== insight.generatedAt ||
    input.sourceHash !== insight.sourceHash
  ) {
    throw new ComponentFeedbackApiError(
      409,
      "分析版本已变更，请刷新后重试",
      "AI_FEEDBACK_GENERATION_MISMATCH",
    );
  }

  const settings = await loadSettingsForEligibility(db);
  const eligibility = resolveComponentFeedbackEligibility(insight, settings);

  if (!eligibility.baseDeep) {
    throw new ComponentFeedbackApiError(
      422,
      "当前 AI 分析不可评价",
      "AI_FEEDBACK_INSIGHT_NOT_READY",
    );
  }

  if (!isComponentTargetEligible(eligibility, input.target)) {
    throw new ComponentFeedbackApiError(
      422,
      "该反馈目标当前不可评价",
      "AI_FEEDBACK_TARGET_NOT_ELIGIBLE",
    );
  }

  let snapshots;
  try {
    snapshots = await resolveComponentFeedbackSnapshots(db, user, insight);
  } catch {
    throw new ComponentFeedbackApiError(
      409,
      "无法解析反馈快照，请稍后重试",
      "AI_FEEDBACK_SNAPSHOT_UNAVAILABLE",
    );
  }

  let upsertResult;
  try {
    upsertResult = await upsertActorComponentFeedback(db, {
      customerId: insight.customerId,
      aiInsightId: insight.id,
      insightGeneratedAt: insight.generatedAt,
      sourceHash: insight.sourceHash,
      model: insight.model,
      promptVersion: insight.promptVersion,
      feedbackTarget: input.target,
      ratingCode: input.rating,
      tags: input.tags,
      snapshots,
      actorUserId: user.id,
    });
  } catch (err) {
    if (err instanceof FeedbackRepositoryError) {
      throw new ComponentFeedbackApiError(
        500,
        "保存反馈失败",
        "AI_FEEDBACK_WRITE_FAILED",
      );
    }
    throw err;
  }

  const generationKey = upsertResult.feedback.generationKey;
  const rows = await listFeedbackForGeneration(db, generationKey);
  const actorRows = rows.filter((row) => row.createdBy === user.id);
  const byTarget = new Map<AiInsightFeedbackComponentTarget, ComponentFeedbackView>();
  for (const row of actorRows) {
    byTarget.set(row.feedbackTarget, row);
  }

  // Ensure the just-written target is present (list should include it).
  byTarget.set(upsertResult.feedback.feedbackTarget, upsertResult.feedback);

  const response: ComponentFeedbackSafeResponse = {
    ok: true,
    generation: {
      insightGeneratedAt: insight.generatedAt,
      sourceHash: insight.sourceHash,
    },
    eligibility,
    feedback: {
      baseDeep: toSafeItem(byTarget.get("base_deep")),
      phase2: toSafeItem(byTarget.get("phase2")),
      suggestedMessage: toSafeItem(byTarget.get("suggested_message")),
    },
  };

  return {
    response,
    feedback: upsertResult.feedback,
    created: upsertResult.created,
  };
}
