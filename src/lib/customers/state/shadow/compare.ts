import type { CustomerScores } from "@/lib/customers/scoring/types";
import type { HeatLevel } from "@/lib/customers/scoring/types";
import type { StateDimensionSnapshot } from "../state-list-reference";
import {
  recordShadowComparison,
  type ShadowComparisonCategory,
} from "./telemetry";

function record(
  category: ShadowComparisonCategory,
): void {
  recordShadowComparison(category);
}

export function recordLegacyToV2Comparisons(
  legacy: CustomerScores,
  v2: StateDimensionSnapshot,
): void {
  const heat = legacy.heatLevel;
  record(`legacy_heat_${heat}__v2_attention_${v2.attentionLevel}`);
  record(`legacy_heat_${heat}__v2_churn_${v2.churnLevel}`);

  if (heat === "silent") {
    record(`legacy_silent__v2_first_contact_${v2.firstContact}`);
    record(`legacy_silent__v2_engagement_${v2.engagement}`);
  }

  record(`v2_follow_up_sla_${v2.followUpSla}`);
  record(`v2_first_contact_${v2.firstContact}`);
  record(`v2_engagement_${v2.engagement}`);
  record(`v2_churn_${v2.churnLevel}`);
  record(`v2_attention_${v2.attentionLevel}`);
}

export function isHighChurnLegacyHeat(heat: HeatLevel): boolean {
  return heat === "high_churn_risk";
}
