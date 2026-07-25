/**
 * Strict request parsing for component feedback PUT.
 */

import {
  validateComponentFeedbackTarget,
  validateFeedbackRating,
  normalizeFeedbackTags,
  type AiInsightFeedbackComponentTarget,
  type AiInsightFeedbackRatingCode,
  type AiInsightFeedbackComponentTag,
} from "@/lib/ai/customer-insights/feedback-contract";

export const AI_FEEDBACK_COMPONENT_MAX_BODY_BYTES = 8 * 1024;

const ALLOWED_KEYS = new Set([
  "insightGeneratedAt",
  "sourceHash",
  "target",
  "rating",
  "tags",
]);

export type ComponentFeedbackPutInput = {
  insightGeneratedAt: string;
  sourceHash: string;
  target: AiInsightFeedbackComponentTarget;
  rating: AiInsightFeedbackRatingCode;
  tags: AiInsightFeedbackComponentTag[];
};

export type ComponentFeedbackPutParseFailure = {
  ok: false;
  errorCode:
    | "AI_FEEDBACK_INVALID_REQUEST"
    | "AI_FEEDBACK_INVALID_TARGET"
    | "AI_FEEDBACK_TARGET_NOT_ALLOWED"
    | "AI_FEEDBACK_INVALID_RATING"
    | "AI_FEEDBACK_INVALID_TAGS"
    | "AI_FEEDBACK_COMMENT_NOT_ALLOWED";
  message: string;
};

export type ComponentFeedbackPutParseResult =
  | { ok: true; value: ComponentFeedbackPutInput }
  | ComponentFeedbackPutParseFailure;

export function parseComponentFeedbackPutBody(
  body: unknown,
): ComponentFeedbackPutParseResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      errorCode: "AI_FEEDBACK_INVALID_REQUEST",
      message: "请求格式无效",
    };
  }

  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) {
      if (key === "comment") {
        return {
          ok: false,
          errorCode: "AI_FEEDBACK_COMMENT_NOT_ALLOWED",
          message: "组件反馈不支持备注",
        };
      }
      return {
        ok: false,
        errorCode: "AI_FEEDBACK_INVALID_REQUEST",
        message: "请求包含不支持的字段",
      };
    }
  }

  if (
    typeof record.insightGeneratedAt !== "string" ||
    record.insightGeneratedAt.trim() === "" ||
    typeof record.sourceHash !== "string" ||
    record.sourceHash.trim() === ""
  ) {
    return {
      ok: false,
      errorCode: "AI_FEEDBACK_INVALID_REQUEST",
      message: "缺少分析版本信息",
    };
  }

  if (record.target === "legacy_overall") {
    return {
      ok: false,
      errorCode: "AI_FEEDBACK_TARGET_NOT_ALLOWED",
      message: "组件反馈不支持整体评分目标",
    };
  }

  const target = validateComponentFeedbackTarget(record.target);
  if (!target) {
    return {
      ok: false,
      errorCode: "AI_FEEDBACK_INVALID_TARGET",
      message: "反馈目标无效",
    };
  }

  const rating = validateFeedbackRating(record.rating);
  if (!rating) {
    return {
      ok: false,
      errorCode: "AI_FEEDBACK_INVALID_RATING",
      message: "反馈评分无效",
    };
  }

  const tags = normalizeFeedbackTags(target, record.tags ?? []);
  if (tags === null) {
    return {
      ok: false,
      errorCode: "AI_FEEDBACK_INVALID_TAGS",
      message: "反馈标签无效",
    };
  }

  return {
    ok: true,
    value: {
      insightGeneratedAt: record.insightGeneratedAt.trim(),
      sourceHash: record.sourceHash.trim(),
      target,
      rating,
      tags,
    },
  };
}
