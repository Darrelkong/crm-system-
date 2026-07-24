/**
 * Gemini Flat Phase 2 contract constants (5C-G1 candidate).
 * Not wired into Production Gemini runtime.
 */

export const GEMINI_PHASE2_FLAT_CONTRACT_VERSION =
  "gemini-phase2-flat-v1" as const;

export const GEMINI_PHASE2_FLAT_ROOT_FIELD = "phase2SignalRows" as const;

export const GEMINI_PHASE2_FLAT_ROW_FIELDS = [
  "kind",
  "code",
  "level",
  "summary",
  "evidenceSourceType",
  "evidenceSourceId",
  "evidenceField",
  "evidenceExcerpt",
] as const;

export type GeminiPhase2FlatRowField =
  (typeof GEMINI_PHASE2_FLAT_ROW_FIELDS)[number];

export const GEMINI_PHASE2_FLAT_KINDS = [
  "opportunity_signal",
  "concern",
  "customer_behavior_risk",
  "recommendation_topic",
] as const;

export type GeminiPhase2FlatKind = (typeof GEMINI_PHASE2_FLAT_KINDS)[number];

/** Provider-facing opportunity codes (lowercase). Domain uses SCREAMING_SNAKE. */
export const GEMINI_PHASE2_FLAT_OPPORTUNITY_CODES = [
  "need_clarity",
  "interaction_activity",
  "customer_initiative",
  "timeline_readiness",
  "document_readiness",
  "next_step_clarity",
  "concern_severity",
  "engagement_risk",
  "record_reliability",
] as const;

export type GeminiPhase2FlatOpportunityCode =
  (typeof GEMINI_PHASE2_FLAT_OPPORTUNITY_CODES)[number];

/** Codes that map onto Phase2ExtractedSignals singleton fields. */
export const GEMINI_PHASE2_FLAT_OPPORTUNITY_SIGNAL_FIELD_CODES = [
  "need_clarity",
  "customer_initiative",
  "timeline_readiness",
  "document_readiness",
] as const;

export const GEMINI_PHASE2_FLAT_RECOMMENDATION_CODE = "follow_up_topic" as const;

/**
 * Provider-only customer behaviour risk codes (exact lowercase match).
 * Reuses existing REPEATED_NO_REPLY semantics as `repeated_no_reply`.
 * Does not include CRM/staff process codes (FOLLOW_UP_OVERDUE, etc.).
 */
export const GEMINI_PHASE2_FLAT_BEHAVIOUR_RISK_CODES = [
  "repeated_no_reply",
  "delayed_response",
  "repeated_postponement",
  "unresolved_concern",
  "reduced_engagement",
  "decision_uncertainty",
  "next_step_avoidance",
] as const;

export type GeminiPhase2FlatBehaviourRiskCode =
  (typeof GEMINI_PHASE2_FLAT_BEHAVIOUR_RISK_CODES)[number];

/** Explicitly rejected / ignored process and scoring codes (not customer behaviour). */
export const GEMINI_PHASE2_FLAT_FORBIDDEN_BEHAVIOUR_RISK_CODES = [
  "crm_process_risk",
  "employee_delay",
  "staff_overdue",
  "follow_up_overdue",
  "reclaim_warning",
  "FOLLOW_UP_OVERDUE",
  "RECLAIM_WARNING",
  "final_score",
  "probability",
  "confidence",
] as const;

export const GEMINI_PHASE2_FLAT_PROVIDER_EVIDENCE_SOURCE_TYPES = [
  "initial_note",
  "follow_up",
  "customer_field",
] as const;

export const GEMINI_PHASE2_FLAT_LEVELS = ["low", "medium", "high"] as const;

export const GEMINI_PHASE2_FLAT_FORBIDDEN_KINDS = [
  "final_score",
  "opportunity_score",
  "confidence",
  "trend",
  "crm_process_risk",
  "metadata",
  "generated_at",
  "prompt_version",
] as const;

/** Server-side parser limits — never placed in Gemini native responseSchema. */
export const GEMINI_PHASE2_FLAT_PARSER_LIMITS = {
  maxRows: 20,
  kindMax: 40,
  codeMax: 80,
  levelMax: 30,
  summaryMax: 500,
  evidenceSourceTypeMax: 40,
  evidenceSourceIdMax: 100,
  evidenceFieldMax: 100,
  evidenceExcerptMax: 500,
} as const;

export const GEMINI_PHASE2_FLAT_COMPLEXITY_BUDGET = {
  maxDepth: 4,
  maxTotalProperties: 24,
  maxSerializedIncrease: 1800,
  phase2EnumCount: 0,
  phase2MinimumCount: 0,
  phase2MaximumCount: 0,
  phase2NullableCount: 0,
  phase2ArrayCount: 1,
  phase2NestedObjectCount: 1,
} as const;
