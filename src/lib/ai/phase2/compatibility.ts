/**
 * Compatibility helpers between legacy intentScore and Phase 2 opportunity.score.
 * Does not mutate stored insights or UI.
 */

export type LegacyInsightScoreView = {
  intentScore: number | null | undefined;
  phase2OpportunityScore: number | null | undefined;
};

export type PrimaryScoreDisplay = {
  primaryScore: number | null;
  primarySource: "opportunity" | "intentScore" | "none";
  showLegacyIntentScore: boolean;
  trend: "unavailable";
};

/**
 * When a valid Phase 2 opportunity score exists, it is the primary score.
 * intentScore remains available for old caches / compatibility details.
 */
export function resolvePrimaryScoreDisplay(
  input: LegacyInsightScoreView,
): PrimaryScoreDisplay {
  if (
    typeof input.phase2OpportunityScore === "number" &&
    Number.isInteger(input.phase2OpportunityScore) &&
    input.phase2OpportunityScore >= 0 &&
    input.phase2OpportunityScore <= 100
  ) {
    return {
      primaryScore: input.phase2OpportunityScore,
      primarySource: "opportunity",
      showLegacyIntentScore: false,
      trend: "unavailable",
    };
  }
  if (
    typeof input.intentScore === "number" &&
    Number.isInteger(input.intentScore) &&
    input.intentScore >= 0 &&
    input.intentScore <= 100
  ) {
    return {
      primaryScore: input.intentScore,
      primarySource: "intentScore",
      showLegacyIntentScore: true,
      trend: "unavailable",
    };
  }
  return {
    primaryScore: null,
    primarySource: "none",
    showLegacyIntentScore: false,
    trend: "unavailable",
  };
}

/** Trend must never be inferred from intentScore vs opportunity.score. */
export function resolveScoreTrend(): "unavailable" {
  return "unavailable";
}
