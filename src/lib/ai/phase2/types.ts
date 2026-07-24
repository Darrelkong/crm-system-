/**
 * Phase 2 (industry assistant) domain types.
 * Pure TypeScript — not wired into the production insight pipeline.
 */

export const PHASE2_VERSION = "phase-2-v1" as const;
export type Phase2Version = typeof PHASE2_VERSION;

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const OPPORTUNITY_CATEGORY_CODES = [
  "NEED_CLARITY",
  "INTERACTION_ACTIVITY",
  "CUSTOMER_INITIATIVE",
  "TIMELINE_READINESS",
  "DOCUMENT_READINESS",
  "NEXT_STEP_CLARITY",
  "CONCERN_SEVERITY",
  "ENGAGEMENT_RISK",
  "RECORD_RELIABILITY",
] as const;
export type OpportunityCategoryCode =
  (typeof OPPORTUNITY_CATEGORY_CODES)[number];

export const PAIN_POINT_CODES = [
  "COST_CONCERN",
  "SECURITY_CONCERN",
  "REMOTE_PROCESS_CONCERN",
  "TIMELINE_CONCERN",
  "DOCUMENT_PREPARATION_DIFFICULTY",
  "FAMILY_ALIGNMENT_CONCERN",
  "TRUST_CONCERN",
  "REVIEW_RESULT_MISUNDERSTANDING",
  "PROCESS_UNCERTAINTY",
  "OTHER_EVIDENCE_BACKED_CONCERN",
] as const;
export type PainPointCode = (typeof PAIN_POINT_CODES)[number];

export const EVIDENCE_SOURCE_TYPES = [
  "initial_note",
  "follow_up",
  "customer_field",
  "system_rule",
] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

export const CUSTOMER_FIELD_WHITELIST = [
  "requested_project_name",
  "sales_stage",
  "source",
  "next_follow_up_at",
  "last_follow_up_at",
  "last_valid_follow_up_at",
  "created_at",
  "customer_intent",
] as const;
export type CustomerFieldWhitelist =
  (typeof CUSTOMER_FIELD_WHITELIST)[number];

export const PHASE2_LIMITS = {
  evidenceExcerptMaxChars: 160,
  evidencePerFactorMax: 3,
  evidencePerPainPointMax: 3,
  evidenceTotalMax: 30,
  painPointsMax: 5,
  riskSignalsMax: 8,
  recommendedActionMaxChars: 400,
  summaryMaxChars: 400,
  topicMaxChars: 200,
  suggestedMessageMaxChars: 500,
  followUpContextMax: 10,
  stageHistoryMax: 20,
  minimumApplicableWeight: 60,
} as const;

export type EvidenceReference = {
  sourceType: EvidenceSourceType;
  sourceId: string | null;
  occurredAt: string | null;
  excerpt: string;
  field: string | null;
};

export type EvidenceBackedFactor = {
  code: string;
  summary: string;
  confidence: ConfidenceLevel;
  evidence: EvidenceReference[];
};

export type OpportunityScoreBreakdown = {
  code: OpportunityCategoryCode;
  labelKey: string;
  weight: number;
  status: "scored" | "insufficient_data" | "not_applicable";
  score: number | null;
  weightedScore: number | null;
  confidence: ConfidenceLevel;
  basis: EvidenceReference[];
  explanation: string;
};

export type OpportunityAssessment = {
  status: "available" | "insufficient_data";
  score: number | null;
  confidence: ConfidenceLevel;
  trend: "up" | "stable" | "down" | "unavailable";
  breakdown: OpportunityScoreBreakdown[];
  positiveFactors: EvidenceBackedFactor[];
  negativeFactors: EvidenceBackedFactor[];
  recommendedAction: string | null;
};

export type PainPointAssessment = {
  code: PainPointCode;
  labelKey: string;
  severity: "low" | "medium" | "high";
  confidence: ConfidenceLevel;
  summary: string;
  evidence: EvidenceReference[];
  recommendedResponse: string | null;
};

export type RiskSignal = {
  code: string;
  summary: string;
  confidence: ConfidenceLevel;
  evidence: EvidenceReference[];
};

export type ChurnRiskAssessment = {
  level: "low" | "medium" | "high" | "insufficient_data";
  confidence: ConfidenceLevel;
  customerBehaviorRisk: RiskSignal[];
  crmProcessRisk: RiskSignal[];
  evidence: EvidenceReference[];
  summary: string;
};

export type FollowUpRecommendation = {
  date: string | null;
  timeWindow: null;
  channel: string | null;
  topic: string | null;
  confidence: ConfidenceLevel;
  basis: EvidenceReference[];
  insufficientDataReason: string | null;
};

export type MissingInformationItem = {
  code: string;
  summary: string;
};

export type Phase2Insight = {
  version: Phase2Version;
  opportunity: OpportunityAssessment;
  painPoints: PainPointAssessment[];
  churnRisk: ChurnRiskAssessment;
  followUpRecommendation: FollowUpRecommendation;
  missingInformation: MissingInformationItem[];
};

/** Provider-extracted signals only — never a final local opportunity score. */
export type EvidenceBackedSignal = {
  level: "low" | "medium" | "high";
  confidence: ConfidenceLevel;
  summary: string;
  evidence: EvidenceReference[];
};

export type EvidenceBackedConcern = EvidenceBackedSignal & {
  code: PainPointCode;
};

export type EvidenceBackedRisk = EvidenceBackedSignal & {
  code: string;
  kind: "customer_behavior" | "crm_process";
};

export type Phase2ExtractedSignals = {
  needClarity: EvidenceBackedSignal | null;
  customerInitiative: EvidenceBackedSignal | null;
  timelineReadiness: EvidenceBackedSignal | null;
  documentReadiness: EvidenceBackedSignal | null;
  concerns: EvidenceBackedConcern[];
  customerBehaviorRisk: EvidenceBackedRisk[];
  recommendedTopic: EvidenceBackedSignal | null;
};

export type Phase2ContactAvailability = {
  hasPhone: boolean;
  hasEmail: boolean;
  hasWeChat: boolean;
  hasAnyContactMethod: boolean;
  contactMethodCount: number;
  contactCompletenessLabel: "none" | "partial" | "complete";
};

export type Phase2FollowUpContext = {
  id: string;
  followUpTime: string;
  channel: string;
  outcome: string;
  summary: string;
  nextAction: string | null;
  nextFollowUpAt: string | null;
  customerIntent: string | null;
  isValidFollowUp: boolean;
};

export type Phase2StageChange = {
  changedAt: string;
  fromStage: string | null;
  toStage: string;
};

export type Phase2HeatSummary = {
  heatLevel: string | null;
  daysWithoutValidFollowUp: number | null;
  nextFollowUpOverdue: boolean;
  reclaimWarningLikely: boolean;
};

export type Phase2Context = {
  customerId: string;
  salesStage: string;
  requestedProjectName: string | null;
  /** Aggregated free-text intent signals (not a DB column). */
  customerIntent: string | null;
  initialNote: string | null;
  source: string | null;
  createdAt: string | null;
  lastFollowUpAt: string | null;
  lastValidFollowUpAt: string | null;
  nextFollowUpAt: string | null;
  contactAvailability: Phase2ContactAvailability;
  heat: Phase2HeatSummary;
  recentFollowUps: Phase2FollowUpContext[];
  /** Reserved; builder may leave empty when history is not supplied. */
  stageHistory: Phase2StageChange[];
};

export type CategoryScoreInput = {
  code: OpportunityCategoryCode;
  status: OpportunityScoreBreakdown["status"];
  score: number | null;
  confidence: ConfidenceLevel;
  basis: EvidenceReference[];
  explanation: string;
};
