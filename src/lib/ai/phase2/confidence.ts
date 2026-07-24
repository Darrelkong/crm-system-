import { MINIMUM_APPLICABLE_WEIGHT } from "@/lib/ai/phase2/scoring-config";
import type {
  ConfidenceLevel,
  OpportunityScoreBreakdown,
} from "@/lib/ai/phase2/types";

export type ConfidenceInput = {
  applicableWeight: number;
  independentEvidenceSourceCount: number;
  hasMajorConflict: boolean;
  onlyInitialNoteEvidence: boolean;
};

/**
 * Deterministic opportunity confidence. Provider must not set the final value.
 */
export function computeOpportunityConfidence(
  input: ConfidenceInput,
): ConfidenceLevel {
  if (input.applicableWeight < MINIMUM_APPLICABLE_WEIGHT) {
    return "low";
  }
  if (input.hasMajorConflict || input.onlyInitialNoteEvidence) {
    return "low";
  }
  if (
    input.applicableWeight >= 85 &&
    input.independentEvidenceSourceCount >= 3
  ) {
    return "high";
  }
  if (
    input.applicableWeight >= 70 &&
    input.independentEvidenceSourceCount >= 2
  ) {
    return "medium";
  }
  if (input.applicableWeight >= 60 && input.applicableWeight <= 69) {
    return "low";
  }
  return "low";
}

export function countIndependentEvidenceSources(
  breakdown: OpportunityScoreBreakdown[],
): number {
  const keys = new Set<string>();
  for (const row of breakdown) {
    for (const item of row.basis) {
      // System rules must not inflate confidence via many RULE_* snippets.
      if (item.sourceType === "system_rule") continue;
      if (item.sourceType === "follow_up") {
        if (!item.sourceId) continue;
        keys.add(`follow_up:${item.sourceId}`);
        continue;
      }
      if (item.sourceType === "initial_note") {
        keys.add("initial_note");
        continue;
      }
      if (item.sourceType === "customer_field") {
        // Distinct allowlisted fields count as distinct sources.
        if (!item.field) continue;
        keys.add(`customer_field:${item.field}`);
      }
    }
  }
  return keys.size;
}

export function isOnlyInitialNoteEvidence(
  breakdown: OpportunityScoreBreakdown[],
): boolean {
  let any = false;
  for (const row of breakdown) {
    for (const item of row.basis) {
      any = true;
      if (item.sourceType !== "initial_note") return false;
    }
  }
  return any;
}
