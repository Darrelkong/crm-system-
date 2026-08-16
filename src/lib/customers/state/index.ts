/**
 * Customer State Engine V2 — public surface.
 *
 * Authority: TASK 17-B-R1 + TASK 17-B-R2.
 *
 * TASK 17-C1 STATUS: this module is deliberately UNUSED by production. Nothing
 * in `src/app/**`, no API route, no dashboard, no notification, no matter, and
 * no UI imports it. Consumer wiring belongs to Phase 17-C4; the SQL mirror to
 * 17-C2; the bounded production shadow to 17-C3.
 */

export { computeCustomerState } from "./engine";

export {
  CUSTOMER_STATE_RULE_VERSION,
  CUSTOMER_STATE_RULE_SECTIONS,
  CUSTOMER_STATE_SPEC_REVISION,
  DEFAULT_CHURN_RULES,
  DEFAULT_COMPLETENESS_RULES,
  DEFAULT_CUSTOMER_STATE_RULES,
  DEFAULT_FIRST_CONTACT_RULES,
  DEFAULT_STAGE_CLASS_RULES,
  DEFAULT_STAGE_SLA_RULES,
  getStageSlaRule,
  isChurnEligibleStage,
  isDeferredStage,
  isExemptStage,
  isHighIntentStage,
  isPostSaleStage,
  resolveCustomerStateRules,
} from "./rules";
export type {
  ChurnRules,
  CompletenessRules,
  CustomerStateRuleSection,
  CustomerStateRules,
  FirstContactRules,
  RuleResolution,
  RuleResolutionWarning,
  StageClassRules,
  StageSlaRule,
  StageSlaRules,
} from "./rules";

export {
  ACTION_ELIGIBLE_REASON_CODES,
  CUSTOMER_STATE_DIMENSIONS,
  CUSTOMER_STATE_REASON_CODES,
  EXCLUSIVE_REASON_CODES,
  RECLAMATION_EXEMPTION_CAUSES,
  STATE_EXEMPTION_CAUSES,
  isCustomerStateReasonCode,
} from "./reason-codes";
export type {
  CustomerStateDimension,
  CustomerStateReasonCode,
  ReclamationExemptionCause,
  StateExemptionCause,
  StateReason,
  StateReasonParams,
} from "./reason-codes";

export {
  ACTIVE_SLA_STAGES,
  CANONICAL_STAGES,
  NON_STAGE_DISPLAY_VALUES,
  SPECIAL_STAGES,
  STAGE_ALIASES,
  isActiveSlaStage,
  isCanonicalStage,
  normalizeSalesStage,
} from "./stages";
export type {
  ActiveSlaStage,
  CanonicalStage,
  NormalizedStage,
  SpecialStage,
} from "./stages";

export {
  ATTENTION_LEVELS,
  CHURN_FAMILIES,
  CHURN_LEVELS,
  ENGAGEMENT_STATES,
  FIRST_CONTACT_STATES,
  FOLLOW_UP_SLA_STATES,
  PROFILE_GROUPS,
  PROFILE_VERDICTS,
  RECLAMATION_RISK_STATES,
  findReason,
  hasReasonCode,
} from "./types";
export type {
  AttentionLevel,
  AttentionLevelResult,
  ChurnFamily,
  ChurnLevel,
  ChurnRiskResult,
  CustomerProfileFacts,
  CustomerState,
  CustomerStateFacts,
  EngagementHealthResult,
  EngagementState,
  FirstContactResult,
  FirstContactState,
  FollowUpOutcomeFact,
  FollowUpSlaResult,
  FollowUpSlaState,
  ProfileCompletenessResult,
  ProfileGroup,
  ProfileVerdict,
  ReclamationRiskResult,
  ReclamationRiskState,
} from "./types";

export { evaluateProfileGroups } from "./profile-completeness";
export { evaluateChurnFamilies } from "./churn-risk";
export type { ChurnFamilyDetail, NonResponseTrigger } from "./churn-risk";
export { resolveStateScope } from "./scope";
export type { StateScope } from "./scope";
export {
  DEFAULT_STATE_TIMEZONE,
  computeEffectiveDueAt,
  computeStageDueAt,
  getElapsedHours,
  getStateCalendarDayDifference,
  parseStateInstant,
} from "./time";
export {
  buildStateDimensionColumns,
  buildStateListFilterSql,
  buildProfileVerdictSql,
  buildProfileScoreSql,
  type StateListFilter,
} from "./state-sql-dimensions";
export {
  countCustomersMatchingStateFilter,
  listCustomerIdsMatchingStateFilter,
  listCustomerIdsMatchingStateFilterPaginated,
  selectStateDimensionsForCustomers,
  CUSTOMER_STATE_FILTER_CANDIDATE_LIMIT,
} from "./state-list-sql";
export {
  evaluateCustomerStateReference,
  filterCustomerIdsReference,
  buildStateFactsFromCustomerRow,
} from "./state-list-reference";
export type { StateDimensionSnapshot } from "./state-list-reference";
export { buildStateSqlClock, buildStateInstantSql } from "./state-sql-primitives";
export { anyPresent, countPresent, hasStateText } from "./text";
