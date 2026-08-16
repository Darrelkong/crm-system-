/**
 * Fact and output contracts for Customer State Engine V2.
 *
 * Authority: TASK 17-B-R1 §C (fact contract) and §F (CustomerState contract).
 *
 * RULE C — a dimension MUST NOT consume a fact not listed against it. Facts
 * whose "May be consumed by" column is `None` are deliberately ABSENT from this
 * type so the compiler enforces the isolation rather than a code comment:
 * `lastFollowUpAt`, `lifecycleStatus`, `pinnedSource`, `source`,
 * `customerType`, `phoneCountryCode`, and every rollout timestamp
 * (`firstContactBacklogCutoff`, RULE V-7 / AC-5).
 */

import type { BusinessTimezone } from "@/lib/settings/effective";
import type {
  CustomerStateReasonCode,
  ReclamationExemptionCause,
  StateExemptionCause,
  StateReason,
} from "./reason-codes";

/**
 * Profile Completeness facts, nested so the dimension that "may read nothing"
 * (RULE X-9) cannot reach a follow-up, ownership, or reclamation fact, and so
 * no other dimension can reach identity fields.
 */
export type CustomerProfileFacts = {
  customerName: string | null;
  nameStatus: string | null;
  phone: string | null;
  wechatId: string | null;
  email: string | null;
  requestedProjectCode: string | null;
  primaryConcern: string | null;
  notes: string | null;
  targetCountryOrRegion: string | null;
  preferredContactMethod: string | null;
  preferredName: string | null;
  gender: string | null;
  ageRange: string | null;
  preferredLanguage: string | null;
  occupation: string | null;
  companyName: string | null;
  jobTitle: string | null;
};

/** One `follow_ups` row reduced to the only two columns Churn may read (RULE C). */
export type FollowUpOutcomeFact = {
  outcome: string;
  followUpTime: string | null;
};

export type CustomerStateFacts = {
  salesStage: string;
  /** Base scope + unowned short-circuit (RULE S-6) + reclamation eligibility. */
  status: string;
  ownerId: string | null;
  /** `EXISTS customer_assignees.role='collaborator'` — Reclamation only. */
  hasCollaborator: boolean;
  /** Reclamation only (RULE N-3, O-3). */
  isPinned: number;
  createdAt: string;
  lastValidFollowUpAt: string | null;
  /** SLA and Attention only. MUST NOT feed Churn or Engagement (RULE K-6, J-2). */
  nextFollowUpAt: string | null;
  reclamationCycleStartedAt: string | null;
  /** Reclamation only (RULE N-3). */
  reclaimRuleGraceUntil: string | null;
  /** Churn only (RULE C, D-3). */
  followUpOutcomes: readonly FollowUpOutcomeFact[];
  profile: CustomerProfileFacts;
  businessTimezone: BusinessTimezone;
  /** Reclamation only (RULE V-4). */
  automaticReclaimDays: number;
};

export const PROFILE_VERDICTS = [
  "complete",
  "minor_gaps",
  "incomplete",
  "critical_gaps",
] as const;
export type ProfileVerdict = (typeof PROFILE_VERDICTS)[number];

export const PROFILE_GROUPS = [
  "REQ_IDENTITY",
  "REQ_REACHABLE",
  "CORE_PRIMARY_CHANNEL",
  "CORE_NEED_CAPTURED",
  "CORE_CONTEXT",
  "OPT_SECOND_CHANNEL",
  "OPT_EMAIL",
  "OPT_PREFERRED_CONTACT",
  "OPT_DEMOGRAPHICS",
  "OPT_PROFESSIONAL",
] as const;
export type ProfileGroup = (typeof PROFILE_GROUPS)[number];

export const FIRST_CONTACT_STATES = [
  "normal",
  "due_soon",
  "overdue",
  "critical",
  "deferred",
  "exempt",
  "not_applicable",
] as const;
export type FirstContactState = (typeof FIRST_CONTACT_STATES)[number];

export const FOLLOW_UP_SLA_STATES = [
  "on_track",
  "due_soon",
  "overdue",
  "severe_overdue",
  "not_started",
  "deferred",
  "exempt",
] as const;
export type FollowUpSlaState = (typeof FOLLOW_UP_SLA_STATES)[number];

export const ENGAGEMENT_STATES = [
  "active",
  "stable",
  "cooling",
  "silent",
  "not_started",
  "deferred",
  "exempt",
] as const;
export type EngagementState = (typeof ENGAGEMENT_STATES)[number];

export const CHURN_LEVELS = ["low", "medium", "high"] as const;
export type ChurnLevel = (typeof CHURN_LEVELS)[number];

export const CHURN_FAMILIES = [
  "ENGAGEMENT_DETERIORATION",
  "REPEATED_NON_RESPONSE",
  "EXPLICIT_NEGATIVE_CUSTOMER_SIGNAL",
] as const;
export type ChurnFamily = (typeof CHURN_FAMILIES)[number];

export const RECLAMATION_RISK_STATES = [
  "none",
  "approaching",
  "warning",
  "final",
  "due",
  "exempt",
] as const;
export type ReclamationRiskState = (typeof RECLAMATION_RISK_STATES)[number];

export const ATTENTION_LEVELS = ["low", "normal", "high", "urgent"] as const;
export type AttentionLevel = (typeof ATTENTION_LEVELS)[number];

export type ProfileCompletenessResult = {
  verdict: ProfileVerdict;
  score: number;
  missingGroups: ProfileGroup[];
};

export type FirstContactResult = {
  state: FirstContactState;
  /** `COALESCE(reclamationCycleStartedAt, createdAt)` when parseable (RULE H-3). */
  anchorAt: string | null;
  /** Fractional elapsed hours; null unless the severity bands were evaluated. */
  ageHours: number | null;
  cause: StateExemptionCause | null;
};

export type FollowUpSlaResult = {
  state: FollowUpSlaState;
  daysSinceValidInteraction: number | null;
  /** R2 §D — null for `not_started`, `deferred`, and `exempt`. */
  stageDueAt: string | null;
  /** R2 §D — `MIN(stageDueAt, parseable nextFollowUpAt)`; null with `stageDueAt`. */
  effectiveDueAt: string | null;
  cause: StateExemptionCause | null;
};

export type EngagementHealthResult = {
  state: EngagementState;
  daysSinceValidInteraction: number | null;
  cause: StateExemptionCause | null;
};

export type ChurnRiskResult = {
  level: ChurnLevel;
  families: ChurnFamily[];
};

export type ReclamationRiskResult = {
  state: ReclamationRiskState;
  /** `getDaysWithoutValidFollowUp` (RULE N-3/N-5); null when exempt. */
  idleDays: number | null;
  daysRemaining: number | null;
  cause: ReclamationExemptionCause | null;
};

export type AttentionLevelResult = {
  level: AttentionLevel;
};

export type CustomerState = {
  profileCompleteness: ProfileCompletenessResult;
  firstContact: FirstContactResult;
  followUpSla: FollowUpSlaResult;
  engagementHealth: EngagementHealthResult;
  churnRisk: ChurnRiskResult;
  reclamationRisk: ReclamationRiskResult;
  attentionLevel: AttentionLevelResult;
  reasons: StateReason[];
  /** RULE W-1/W-2. */
  ruleVersion: string;
  /** RULE F-3 — MUST equal the injected `now`. */
  evaluatedAt: string;
};

export function hasReasonCode(
  state: Pick<CustomerState, "reasons">,
  code: CustomerStateReasonCode,
): boolean {
  return state.reasons.some((entry) => entry.code === code);
}

export function findReason(
  state: Pick<CustomerState, "reasons">,
  code: CustomerStateReasonCode,
): StateReason | undefined {
  return state.reasons.find((entry) => entry.code === code);
}
