/**
 * Server-authoritative target eligibility for Phase 5D-2 component feedback.
 * Never trust client claims that a target is visible.
 */

import type { CustomerAiInsightView } from "@/lib/ai/customer-insights/service";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import { isValidDeepInsight } from "@/lib/ai/deep-analysis/availability";
import { hasRenderablePhase2 } from "@/components/customers/phase2-panel-display";
import { isSafeSuggestedMessageAvailable } from "@/lib/ai/customer-insights/safe-suggested-message";
import type { AiInsightFeedbackComponentTarget } from "@/lib/ai/customer-insights/feedback-contract";

export type ComponentFeedbackEligibility = {
  baseDeep: boolean;
  phase2: boolean;
  suggestedMessage: boolean;
};

/**
 * `settings=null` means settings could not be loaded safely — suggested_message
 * stays ineligible (never default aiShowDraftMessage to true).
 */
export function resolveComponentFeedbackEligibility(
  insight: CustomerAiInsightView | null,
  settings: Pick<EffectiveAiSettings, "aiShowDraftMessage"> | null,
): ComponentFeedbackEligibility {
  if (!insight || !isValidDeepInsight(insight)) {
    return {
      baseDeep: false,
      phase2: false,
      suggestedMessage: false,
    };
  }

  const phase2Eligible = hasRenderablePhase2(insight.phase2);
  const messageEligible =
    !!settings?.aiShowDraftMessage &&
    isSafeSuggestedMessageAvailable(insight.suggestedEmployeeMessage);

  return {
    baseDeep: true,
    phase2: phase2Eligible,
    suggestedMessage: messageEligible,
  };
}

export function isComponentTargetEligible(
  eligibility: ComponentFeedbackEligibility,
  target: AiInsightFeedbackComponentTarget,
): boolean {
  if (target === "base_deep") return eligibility.baseDeep;
  if (target === "phase2") return eligibility.phase2;
  return eligibility.suggestedMessage;
}

export function resolvePhase2GeneratedSnapshot(
  insight: CustomerAiInsightView,
): boolean {
  return hasRenderablePhase2(insight.phase2);
}
