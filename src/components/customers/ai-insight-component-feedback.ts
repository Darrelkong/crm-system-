/**
 * Client-side tag allowlists and helpers for Phase 5D-3 component feedback UI.
 * Tag codes match 5D-1 contract; labels come from i18n.
 */

import {
  AI_INSIGHT_FEEDBACK_BASE_DEEP_NEGATIVE_TAGS,
  AI_INSIGHT_FEEDBACK_BASE_DEEP_POSITIVE_TAGS,
  AI_INSIGHT_FEEDBACK_MAX_COMPONENT_TAGS,
  AI_INSIGHT_FEEDBACK_PHASE2_NEGATIVE_TAGS,
  AI_INSIGHT_FEEDBACK_PHASE2_POSITIVE_TAGS,
  AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_NEGATIVE_TAGS,
  AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_POSITIVE_TAGS,
  type AiInsightFeedbackComponentTag,
  type AiInsightFeedbackComponentTarget,
  type AiInsightFeedbackRatingCode,
} from "@/lib/ai/customer-insights/feedback-contract";

export type ComponentFeedbackUiTarget = AiInsightFeedbackComponentTarget;

export const COMPONENT_FEEDBACK_MAX_TAGS = AI_INSIGHT_FEEDBACK_MAX_COMPONENT_TAGS;

export function tagsForTargetRating(
  target: ComponentFeedbackUiTarget,
  rating: AiInsightFeedbackRatingCode,
): readonly AiInsightFeedbackComponentTag[] {
  if (target === "base_deep") {
    return rating === "helpful"
      ? AI_INSIGHT_FEEDBACK_BASE_DEEP_POSITIVE_TAGS
      : AI_INSIGHT_FEEDBACK_BASE_DEEP_NEGATIVE_TAGS;
  }
  if (target === "phase2") {
    return rating === "helpful"
      ? AI_INSIGHT_FEEDBACK_PHASE2_POSITIVE_TAGS
      : AI_INSIGHT_FEEDBACK_PHASE2_NEGATIVE_TAGS;
  }
  return rating === "helpful"
    ? AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_POSITIVE_TAGS
    : AI_INSIGHT_FEEDBACK_SUGGESTED_MESSAGE_NEGATIVE_TAGS;
}

export function tagLabelKey(
  target: ComponentFeedbackUiTarget,
  tag: string,
): string {
  return `customers.aiInsightComponentFeedback.tags.${target}.${tag}`;
}

export function toggleDraftTag(
  current: readonly string[],
  tag: string,
  max = COMPONENT_FEEDBACK_MAX_TAGS,
): string[] {
  if (current.includes(tag)) {
    return current.filter((item) => item !== tag);
  }
  if (current.length >= max) {
    return [...current];
  }
  return [...current, tag];
}

export function draftsDifferFromSaved(
  draft: readonly string[],
  saved: readonly string[],
): boolean {
  if (draft.length !== saved.length) return true;
  const savedSet = new Set(saved);
  return draft.some((tag) => !savedSet.has(tag));
}

export type ComponentFeedbackPutBody = {
  insightGeneratedAt: string;
  sourceHash: string;
  target: ComponentFeedbackUiTarget;
  rating: AiInsightFeedbackRatingCode;
  tags: string[];
};

/** Exact PUT body — never include customer/AI content or actor fields. */
export function buildComponentFeedbackPutBody(input: {
  insightGeneratedAt: string;
  sourceHash: string;
  target: ComponentFeedbackUiTarget;
  rating: AiInsightFeedbackRatingCode;
  tags: readonly string[];
}): ComponentFeedbackPutBody {
  return {
    insightGeneratedAt: input.insightGeneratedAt,
    sourceHash: input.sourceHash,
    target: input.target,
    rating: input.rating,
    tags: [...input.tags],
  };
}

export const COMPONENT_FEEDBACK_PUT_ALLOWED_KEYS = [
  "insightGeneratedAt",
  "sourceHash",
  "target",
  "rating",
  "tags",
] as const;

export function assertExactPutBodyKeys(body: Record<string, unknown>): void {
  const keys = Object.keys(body).sort();
  const expected = [...COMPONENT_FEEDBACK_PUT_ALLOWED_KEYS].sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    throw new Error(`Unexpected PUT body keys: ${keys.join(",")}`);
  }
}

export type ComponentFeedbackApiItem = {
  rating: AiInsightFeedbackRatingCode;
  tags: string[];
  updatedAt: string;
};

export type ComponentFeedbackApiResponse = {
  ok: true;
  generation: {
    insightGeneratedAt: string;
    sourceHash: string;
  } | null;
  eligibility: {
    baseDeep: boolean;
    phase2: boolean;
    suggestedMessage: boolean;
  };
  feedback: {
    baseDeep: ComponentFeedbackApiItem | null;
    phase2: ComponentFeedbackApiItem | null;
    suggestedMessage: ComponentFeedbackApiItem | null;
  };
};

export function targetToFeedbackKey(
  target: ComponentFeedbackUiTarget,
): "baseDeep" | "phase2" | "suggestedMessage" {
  if (target === "base_deep") return "baseDeep";
  if (target === "phase2") return "phase2";
  return "suggestedMessage";
}

export function eligibilityForTarget(
  eligibility: ComponentFeedbackApiResponse["eligibility"] | null,
  target: ComponentFeedbackUiTarget,
): boolean {
  if (!eligibility) return false;
  if (target === "base_deep") return eligibility.baseDeep;
  if (target === "phase2") return eligibility.phase2;
  return eligibility.suggestedMessage;
}
