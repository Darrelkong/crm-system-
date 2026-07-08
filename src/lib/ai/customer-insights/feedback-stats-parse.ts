import {
  AI_INSIGHT_FEEDBACK_REASON_TAGS,
  type AiInsightFeedbackReasonTag,
} from "../../../../drizzle/schema/ai-insight-feedback";

export function parseReasonTagsFromJson(
  reasonTagsJson: string,
): AiInsightFeedbackReasonTag[] {
  try {
    const parsed = JSON.parse(reasonTagsJson) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const normalized: AiInsightFeedbackReasonTag[] = [];
    for (const tag of parsed) {
      if (
        typeof tag === "string" &&
        AI_INSIGHT_FEEDBACK_REASON_TAGS.includes(tag as AiInsightFeedbackReasonTag) &&
        !normalized.includes(tag as AiInsightFeedbackReasonTag)
      ) {
        normalized.push(tag as AiInsightFeedbackReasonTag);
      }
    }
    return normalized;
  } catch {
    return [];
  }
}
