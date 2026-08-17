import type { AttentionLevel } from "../types";
import type { ChurnLevel } from "../types";
import type { EngagementState } from "../types";
import type { FirstContactState } from "../types";
import type { FollowUpSlaState } from "../types";
import type { HeatLevel } from "@/lib/customers/scoring/types";

export type ShadowComparisonCategory =
  | `legacy_heat_${HeatLevel}__v2_attention_${AttentionLevel}`
  | `legacy_heat_${HeatLevel}__v2_churn_${ChurnLevel}`
  | `legacy_silent__v2_first_contact_${FirstContactState}`
  | `legacy_silent__v2_engagement_${EngagementState}`
  | `v2_follow_up_sla_${FollowUpSlaState}`
  | `v2_first_contact_${FirstContactState}`
  | `v2_engagement_${EngagementState}`
  | `v2_churn_${ChurnLevel}`
  | `v2_attention_${AttentionLevel}`;

export type ShadowTelemetryCounters = {
  requestsConsidered: number;
  requestsSampled: number;
  requestsSkippedUnsampled: number;
  requestsSkippedDisabled: number;
  requestsSkippedCircuitOpen: number;
  customersCompared: number;
  skippedInsufficientFacts: number;
  shadowErrors: number;
  comparisons: Partial<Record<ShadowComparisonCategory, number>>;
};

const counters: ShadowTelemetryCounters = {
  requestsConsidered: 0,
  requestsSampled: 0,
  requestsSkippedUnsampled: 0,
  requestsSkippedDisabled: 0,
  requestsSkippedCircuitOpen: 0,
  customersCompared: 0,
  skippedInsufficientFacts: 0,
  shadowErrors: 0,
  comparisons: {},
};

function bumpComparison(category: ShadowComparisonCategory): void {
  counters.comparisons[category] = (counters.comparisons[category] ?? 0) + 1;
}

export function recordShadowRequestConsidered(): void {
  counters.requestsConsidered += 1;
}

export function recordShadowRequestSampled(): void {
  counters.requestsSampled += 1;
}

export function recordShadowRequestSkippedUnsampled(): void {
  counters.requestsSkippedUnsampled += 1;
}

export function recordShadowRequestSkippedDisabled(): void {
  counters.requestsSkippedDisabled += 1;
}

export function recordShadowRequestSkippedCircuitOpen(): void {
  counters.requestsSkippedCircuitOpen += 1;
}

export function recordShadowCustomerCompared(): void {
  counters.customersCompared += 1;
}

export function recordShadowSkippedInsufficientFacts(): void {
  counters.skippedInsufficientFacts += 1;
}

export function recordShadowError(): void {
  counters.shadowErrors += 1;
}

export function recordShadowComparison(category: ShadowComparisonCategory): void {
  bumpComparison(category);
}

export function getShadowTelemetrySnapshot(): Readonly<ShadowTelemetryCounters> {
  return {
    ...counters,
    comparisons: { ...counters.comparisons },
  };
}

export function resetShadowTelemetryForTests(): void {
  counters.requestsConsidered = 0;
  counters.requestsSampled = 0;
  counters.requestsSkippedUnsampled = 0;
  counters.requestsSkippedDisabled = 0;
  counters.requestsSkippedCircuitOpen = 0;
  counters.customersCompared = 0;
  counters.skippedInsufficientFacts = 0;
  counters.shadowErrors = 0;
  counters.comparisons = {};
}

/** Ensures exported telemetry contains no PII-shaped keys. */
export function assertShadowTelemetryHasNoPii(
  snapshot: ShadowTelemetryCounters,
): void {
  const serialized = JSON.stringify(snapshot);
  const forbidden = [
    "customerName",
    "phone",
    "email",
    "wechat",
    "notes",
    "followUp",
    "customerId",
    "customer_id",
  ];
  for (const token of forbidden) {
    if (serialized.toLowerCase().includes(token.toLowerCase())) {
      throw new Error(`shadow telemetry must not contain ${token}`);
    }
  }
}
