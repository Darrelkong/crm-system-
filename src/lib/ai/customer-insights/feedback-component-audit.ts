/**
 * Safe audit metadata for Phase 5D-2 component feedback.
 * Never include PII, sourceHash, generationKey, comment, or provider raw output.
 */

import type { ComponentFeedbackView } from "@/lib/ai/customer-insights/feedback-repository";

export const AI_FEEDBACK_COMPONENT_AUDIT_CREATED =
  "customer.ai_insight_feedback.component_created" as const;

export const AI_FEEDBACK_COMPONENT_AUDIT_UPDATED =
  "customer.ai_insight_feedback.component_updated" as const;

export function buildComponentFeedbackAuditMetadata(
  feedback: ComponentFeedbackView,
  operation: "create" | "update",
): Record<string, string | number | boolean | string[]> {
  return {
    feedbackTarget: feedback.feedbackTarget,
    ratingCode: feedback.ratingCode,
    reasonTagCodes: feedback.reasonTags,
    reasonTagCount: feedback.reasonTags.length,
    insightGeneratedAt: feedback.insightGeneratedAt,
    phase2Generated: feedback.phase2GeneratedSnapshot,
    providerSnapshot: feedback.providerSnapshot,
    contractModeSnapshot: feedback.contractModeSnapshot,
    operation,
  };
}
