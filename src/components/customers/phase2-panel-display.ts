import type { Phase2Insight } from "@/lib/ai/phase2/types";
import { resolvePrimaryScoreDisplay } from "@/lib/ai/phase2/compatibility";

/** True when stored/GET insight includes a renderable Phase 2 payload. */
export function hasRenderablePhase2(
  phase2: Phase2Insight | null | undefined,
): phase2 is Phase2Insight {
  return phase2 != null && typeof phase2 === "object" && !!phase2.opportunity;
}

export type OpportunityScoreDisplay =
  | { kind: "score"; score: number }
  | { kind: "insufficient" };

/**
 * score=0 is a valid score and must not be treated as falsy.
 * insufficient_data / null score never render as 0.
 */
export function resolveOpportunityScoreDisplay(
  opportunity: Phase2Insight["opportunity"] | null | undefined,
): OpportunityScoreDisplay {
  if (
    opportunity &&
    opportunity.status === "available" &&
    typeof opportunity.score === "number" &&
    Number.isInteger(opportunity.score) &&
    opportunity.score >= 0 &&
    opportunity.score <= 100
  ) {
    return { kind: "score", score: opportunity.score };
  }
  return { kind: "insufficient" };
}

/**
 * When a valid opportunity score (including 0) exists, Opportunity Score is primary
 * and the legacy intentScore number should not share equal visual weight.
 */
export function shouldDeemphasizeIntentScore(
  phase2: Phase2Insight | null | undefined,
  intentScore: number | null | undefined,
): boolean {
  const scoreDisplay = resolveOpportunityScoreDisplay(
    hasRenderablePhase2(phase2) ? phase2.opportunity : null,
  );
  const display = resolvePrimaryScoreDisplay({
    intentScore,
    phase2OpportunityScore:
      scoreDisplay.kind === "score" ? scoreDisplay.score : null,
  });
  return display.primarySource === "opportunity";
}

/** One-shot notice after a successful refresh that could not produce Phase 2. */
export function shouldShowAdvancedUnavailableNotice(input: {
  refreshSucceeded: boolean;
  phase2Generated: boolean | undefined;
}): boolean {
  return input.refreshSucceeded && input.phase2Generated === false;
}

/** Stable identity for resetting local suggested-message draft state. */
export function buildSuggestedMessageResetKey(input: {
  customerId: string;
  insightId: string;
  generatedAt: string;
  sourceMessage: string;
}): string {
  return [
    input.customerId,
    input.insightId,
    input.generatedAt,
    input.sourceMessage,
  ].join("\u0001");
}
