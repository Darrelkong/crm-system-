/**
 * Closed reason-code registry for Customer State Engine V2.
 *
 * Authority: TASK 17-B-R1 §Q (RULE Q-0..Q-5), TASK 17-B-R2 §B.
 *
 * RULE Q-5 — this list is closed and complete. `DEFERRAL_ENDED` and
 * `SLA_STAGE_UNKNOWN` do not exist in V2 and MUST NOT be reintroduced.
 */

export const CUSTOMER_STATE_DIMENSIONS = [
  "engine",
  "profile",
  "first_contact",
  "sla",
  "engagement",
  "churn",
  "reclamation",
  "deferral",
  "attention",
] as const;

export type CustomerStateDimension = (typeof CUSTOMER_STATE_DIMENSIONS)[number];

/** RULE Q-0 — generic exemption / non-applicability causes shared by the stage-driven dimensions. */
export const STATE_EXEMPTION_CAUSES = [
  "post_sale",
  "closed_lost",
  "stage_unknown",
  "unowned",
] as const;

export type StateExemptionCause = (typeof STATE_EXEMPTION_CAUSES)[number];

/**
 * Reclamation exemption causes. Reclamation has its own cause vocabulary because
 * its exemptions come from ownership policy, not from sales-stage semantics
 * (RULE N-3; scenario 55 uses `collaborator`).
 */
export const RECLAMATION_EXEMPTION_CAUSES = [
  "excluded_stage",
  "pinned",
  "collaborator",
  "unowned",
  "not_active",
  "rule_grace",
] as const;

export type ReclamationExemptionCause =
  (typeof RECLAMATION_EXEMPTION_CAUSES)[number];

export const CUSTOMER_STATE_REASON_CODES = [
  // Engine meta
  "STATE_STAGE_UNKNOWN",

  // Profile Completeness
  "PROFILE_REQUIRED_IDENTITY_MISSING",
  "PROFILE_REQUIRED_CONTACT_MISSING",
  "PROFILE_CORE_PRIMARY_CHANNEL_MISSING",
  "PROFILE_CORE_NEED_NOT_CAPTURED",
  "PROFILE_CORE_CONTEXT_MISSING",
  "PROFILE_OPTIONAL_GAPS",

  // First Contact
  "FIRST_CONTACT_EXEMPT",
  "FIRST_CONTACT_NOT_APPLICABLE",
  "FIRST_CONTACT_DUE_SOON",
  "FIRST_CONTACT_OVERDUE",
  "FIRST_CONTACT_CRITICAL",
  "FIRST_CONTACT_ANCHOR_REASSIGNED",
  "FIRST_CONTACT_ANCHOR_UNPARSEABLE",

  // Follow-up SLA
  "SLA_EXEMPT",
  "SLA_NOT_STARTED",
  "SLA_STAGE_TARGET_EXCEEDED",
  "SLA_WARNING_REACHED",
  "SLA_OVERDUE",
  "SLA_OVERDUE_SEVERE",
  "SLA_NEXT_ACTION_OVERDUE",

  // Engagement Health
  "ENGAGEMENT_EXEMPT",
  "ENGAGEMENT_NOT_STARTED",
  "ENGAGEMENT_STABLE",
  "ENGAGEMENT_COOLING",
  "ENGAGEMENT_SILENT",

  // Churn Risk
  "CHURN_ENGAGEMENT_DETERIORATION",
  "CHURN_REPEATED_NON_RESPONSE",
  "CHURN_LOST_CONTACT",
  "CHURN_NOT_INTERESTED",
  "CHURN_NOT_APPLICABLE_NO_PRIOR_ENGAGEMENT",
  "CHURN_NOT_APPLICABLE_POST_SALE",
  "CHURN_NOT_APPLICABLE_CLOSED_LOST",
  "CHURN_NOT_APPLICABLE_STAGE_UNKNOWN",
  "CHURN_NOT_APPLICABLE_UNOWNED",
  "CHURN_DEFERRED",

  // Reclamation Risk (reporting only)
  "RECLAMATION_APPROACHING",
  "RECLAMATION_WARNING",
  "RECLAMATION_FINAL",
  "RECLAMATION_DUE",
  "RECLAMATION_EXEMPT",

  // Deferred
  "DEFERRAL_ON_HOLD",

  // Attention Level
  "ATTENTION_URGENT_FIRST_CONTACT",
  "ATTENTION_URGENT_SLA_SEVERE",
  "ATTENTION_URGENT_RECLAMATION",
  "ATTENTION_URGENT_CHURN",
  "ATTENTION_HIGH_FIRST_CONTACT",
  "ATTENTION_HIGH_SLA_OVERDUE",
  "ATTENTION_HIGH_SLA_WARNING",
  "ATTENTION_HIGH_RECLAMATION",
  "ATTENTION_HIGH_CHURN_HIGH_INTENT",
  "ATTENTION_NORMAL_FIRST_CONTACT",
  "ATTENTION_NORMAL_SLA_DUE_SOON",
  "ATTENTION_NORMAL_RECLAMATION",
  "ATTENTION_NORMAL_CHURN",
] as const;

export type CustomerStateReasonCode =
  (typeof CUSTOMER_STATE_REASON_CODES)[number];

/** RULE Q-2 — parameters are structured values, never interpolated into the code. */
export type StateReasonParams = Readonly<
  Record<string, string | number | boolean | readonly string[] | null>
>;

export type StateReason = {
  code: CustomerStateReasonCode;
  dimension: CustomerStateDimension;
  params?: StateReasonParams;
};

/**
 * RULE Q-3 — codes that MUST NOT co-occur with another exclusive code of the
 * same dimension. `SLA_OVERDUE` and `SLA_OVERDUE_SEVERE` are exclusive with
 * each other, which this set expresses per-dimension.
 */
export const EXCLUSIVE_REASON_CODES: ReadonlySet<CustomerStateReasonCode> =
  new Set<CustomerStateReasonCode>([
    "FIRST_CONTACT_EXEMPT",
    "FIRST_CONTACT_NOT_APPLICABLE",
    "FIRST_CONTACT_DUE_SOON",
    "FIRST_CONTACT_OVERDUE",
    "FIRST_CONTACT_CRITICAL",
    "SLA_EXEMPT",
    "SLA_NOT_STARTED",
    "SLA_OVERDUE",
    "SLA_OVERDUE_SEVERE",
    "ENGAGEMENT_EXEMPT",
    "ENGAGEMENT_NOT_STARTED",
    "ENGAGEMENT_STABLE",
    "ENGAGEMENT_COOLING",
    "ENGAGEMENT_SILENT",
    "CHURN_NOT_APPLICABLE_NO_PRIOR_ENGAGEMENT",
    "CHURN_NOT_APPLICABLE_POST_SALE",
    "CHURN_NOT_APPLICABLE_CLOSED_LOST",
    "CHURN_NOT_APPLICABLE_STAGE_UNKNOWN",
    "CHURN_NOT_APPLICABLE_UNOWNED",
    "CHURN_DEFERRED",
    "RECLAMATION_APPROACHING",
    "RECLAMATION_WARNING",
    "RECLAMATION_FINAL",
    "RECLAMATION_DUE",
    "RECLAMATION_EXEMPT",
  ]);

/**
 * RULE Q-4 — the only codes Phase 17-C5 may consider wiring to Notifications
 * or Matters. A code absent here MUST NOT become action-producing without a
 * specification amendment.
 */
export const ACTION_ELIGIBLE_REASON_CODES: ReadonlySet<CustomerStateReasonCode> =
  new Set<CustomerStateReasonCode>([
    "FIRST_CONTACT_DUE_SOON",
    "FIRST_CONTACT_OVERDUE",
    "FIRST_CONTACT_CRITICAL",
    "SLA_STAGE_TARGET_EXCEEDED",
    "SLA_WARNING_REACHED",
    "SLA_OVERDUE",
    "SLA_OVERDUE_SEVERE",
    "SLA_NEXT_ACTION_OVERDUE",
    "ENGAGEMENT_SILENT",
    "CHURN_ENGAGEMENT_DETERIORATION",
    "CHURN_REPEATED_NON_RESPONSE",
    "CHURN_LOST_CONTACT",
    "CHURN_NOT_INTERESTED",
    "RECLAMATION_APPROACHING",
    "RECLAMATION_WARNING",
    "RECLAMATION_FINAL",
    "RECLAMATION_DUE",
    "ATTENTION_URGENT_FIRST_CONTACT",
    "ATTENTION_URGENT_SLA_SEVERE",
    "ATTENTION_URGENT_RECLAMATION",
    "ATTENTION_URGENT_CHURN",
    "ATTENTION_HIGH_FIRST_CONTACT",
    "ATTENTION_HIGH_SLA_OVERDUE",
    "ATTENTION_HIGH_SLA_WARNING",
    "ATTENTION_HIGH_RECLAMATION",
    "ATTENTION_HIGH_CHURN_HIGH_INTENT",
    "ATTENTION_NORMAL_FIRST_CONTACT",
    "ATTENTION_NORMAL_SLA_DUE_SOON",
    "ATTENTION_NORMAL_RECLAMATION",
    "ATTENTION_NORMAL_CHURN",
  ]);

export function isCustomerStateReasonCode(
  value: string,
): value is CustomerStateReasonCode {
  return (CUSTOMER_STATE_REASON_CODES as readonly string[]).includes(value);
}

export function reason(
  code: CustomerStateReasonCode,
  dimension: CustomerStateDimension,
  params?: StateReasonParams,
): StateReason {
  return params ? { code, dimension, params } : { code, dimension };
}
