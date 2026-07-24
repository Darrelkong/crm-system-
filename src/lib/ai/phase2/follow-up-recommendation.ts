import type {
  FollowUpRecommendation,
  Phase2Context,
  Phase2ExtractedSignals,
} from "@/lib/ai/phase2/types";

/**
 * Accepts YYYY-MM-DD (optionally prefixed in an ISO timestamp) only when the
 * calendar date is real. Rejects 2026-02-30, month 13, etc.
 */
export function parseExplicitCalendarDate(
  isoOrDate: string | null | undefined,
): string | null {
  if (!isoOrDate) return null;
  const match = isoOrDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * First-version follow-up recommendation.
 * timeWindow is always null. No timezone or reply-time inference.
 */
export function buildFollowUpRecommendation(input: {
  context: Phase2Context;
  signals?: Phase2ExtractedSignals | null;
}): FollowUpRecommendation {
  const { context, signals } = input;
  const basis = [];

  let date: string | null = null;
  if (context.nextFollowUpAt) {
    date = parseExplicitCalendarDate(context.nextFollowUpAt);
    if (date) {
      basis.push({
        sourceType: "customer_field" as const,
        sourceId: null,
        occurredAt: context.nextFollowUpAt,
        excerpt: context.nextFollowUpAt,
        field: "next_follow_up_at",
      });
    }
  }

  let channel: string | null = null;
  if (context.contactAvailability.hasWeChat) channel = "wechat";
  else if (context.contactAvailability.hasPhone) channel = "phone";
  else if (context.contactAvailability.hasEmail) channel = "email";

  let topic: string | null = null;
  let confidence: FollowUpRecommendation["confidence"] = "low";
  if (signals?.recommendedTopic) {
    topic = signals.recommendedTopic.summary.slice(0, 200);
    basis.push(...signals.recommendedTopic.evidence.slice(0, 2));
    confidence = signals.recommendedTopic.confidence;
  }

  if (date) {
    confidence = "medium";
  }

  if (!date && !topic) {
    return {
      date: null,
      timeWindow: null,
      channel,
      topic: null,
      confidence: "low",
      basis: basis.slice(0, 3),
      insufficientDataReason:
        "No explicit next_follow_up_at or appointment evidence; reply-time windows are not inferred",
    };
  }

  return {
    date,
    timeWindow: null,
    channel,
    topic,
    confidence,
    basis: basis.slice(0, 3),
    insufficientDataReason: date
      ? null
      : "Date unavailable; only topic/channel hints present",
  };
}
