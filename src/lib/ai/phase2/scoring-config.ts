import type { OpportunityCategoryCode } from "@/lib/ai/phase2/types";

const WEIGHTS = {
  NEED_CLARITY: 15,
  INTERACTION_ACTIVITY: 15,
  CUSTOMER_INITIATIVE: 15,
  TIMELINE_READINESS: 10,
  DOCUMENT_READINESS: 10,
  NEXT_STEP_CLARITY: 15,
  CONCERN_SEVERITY: 10,
  ENGAGEMENT_RISK: 5,
  RECORD_RELIABILITY: 5,
} as const satisfies Record<OpportunityCategoryCode, number>;

export const OPPORTUNITY_CATEGORY_WEIGHTS: Readonly<
  Record<OpportunityCategoryCode, number>
> = Object.freeze({ ...WEIGHTS });

const LABEL_KEYS = {
  NEED_CLARITY: "phase2.opportunity.needClarity",
  INTERACTION_ACTIVITY: "phase2.opportunity.interactionActivity",
  CUSTOMER_INITIATIVE: "phase2.opportunity.customerInitiative",
  TIMELINE_READINESS: "phase2.opportunity.timelineReadiness",
  DOCUMENT_READINESS: "phase2.opportunity.documentReadiness",
  NEXT_STEP_CLARITY: "phase2.opportunity.nextStepClarity",
  CONCERN_SEVERITY: "phase2.opportunity.concernSeverity",
  ENGAGEMENT_RISK: "phase2.opportunity.engagementRisk",
  RECORD_RELIABILITY: "phase2.opportunity.recordReliability",
} as const satisfies Record<OpportunityCategoryCode, string>;

export const OPPORTUNITY_CATEGORY_LABEL_KEYS: Readonly<
  Record<OpportunityCategoryCode, string>
> = Object.freeze({ ...LABEL_KEYS });

export const TOTAL_CATEGORY_WEIGHT = (
  Object.values(WEIGHTS) as number[]
).reduce((sum, w) => sum + w, 0);

export const MINIMUM_APPLICABLE_WEIGHT = 60;

if (TOTAL_CATEGORY_WEIGHT !== 100) {
  throw new Error(
    `Phase 2 opportunity weights must total 100 (got ${TOTAL_CATEGORY_WEIGHT})`,
  );
}
