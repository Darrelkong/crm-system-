/**
 * Rule contract, code defaults, and pure resolution layer for
 * Customer State Engine V2.
 *
 * Authority: TASK 17-B-R1 §V (settings contract), §S-1 (locked stage table),
 * §L-3 (locked Family B counts), §G (locked completeness groups), §W (versioning).
 *
 * RULE V-2 — code-level defaults exist for every value and equal the locked
 *            specification values.
 * RULE V-3 — malformed, partial, or absent input falls back to validated
 *            defaults, all-or-nothing PER TOP-LEVEL SECTION, and never throws.
 * RULE V-4 — `automatic_reclaim_days` stays a separate scalar setting and is
 *            deliberately absent from this contract.
 * RULE V-6 — `customer_state_rules` is absent from production today; the engine
 *            MUST operate correctly on code defaults alone.
 * RULE V-7 — no rollout timestamp may appear here.
 *
 * TASK 17-C1 scope: this resolver is NOT connected to `system_settings`. It
 * exists so the future integration has one validated entry point. Resolution
 * returns structured warnings instead of logging, because the pure evaluator
 * must have no side effects; the future settings caller owns the logging
 * required by RULE V-3.
 */

import type { ActiveSlaStage, CanonicalStage } from "./stages";
import { ACTIVE_SLA_STAGES } from "./stages";
import { PROFILE_GROUPS, type ProfileGroup } from "./types";

/** RULE W-1 — initial stable identifier. */
export const CUSTOMER_STATE_RULE_VERSION = "customer_state_v2";

/** RULE W-1 — recorded alongside the version for traceability. */
export const CUSTOMER_STATE_SPEC_REVISION = "17-B-R1+17-B-R2";

export type FirstContactRules = {
  dueSoonHours: number;
  overdueHours: number;
  criticalHours: number;
};

export type StageSlaRule = {
  targetDays: number;
  warningDays: number;
  overdueDays: number;
  severeDays: number;
};

export type StageSlaRules = Readonly<Record<ActiveSlaStage, StageSlaRule>>;

export type StageClassRules = {
  churnEligible: readonly CanonicalStage[];
  highIntent: readonly CanonicalStage[];
  postSaleExcluded: readonly CanonicalStage[];
  exempt: readonly CanonicalStage[];
  deferred: readonly CanonicalStage[];
};

export type ChurnRules = {
  repeatedNonResponseWindowDays: number;
  noReplyMinCount: number;
  noContactMinCount: number;
  mixedNoReplyMinCount: number;
  mixedNoContactMinCount: number;
  noReplyOutcomes: readonly string[];
  noContactOutcomes: readonly string[];
  decisiveOutcomes: readonly string[];
};

export type CompletenessRules = {
  requiredGroups: readonly ProfileGroup[];
  coreGroups: readonly ProfileGroup[];
  optionalGroups: readonly ProfileGroup[];
  weights: Readonly<Record<ProfileGroup, number>>;
};

export type CustomerStateRules = {
  ruleVersion: string;
  firstContact: FirstContactRules;
  stageSla: StageSlaRules;
  stageClasses: StageClassRules;
  churn: ChurnRules;
  completeness: CompletenessRules;
};

/** RULE H-4 — locked 24 / 48 / 72 elapsed-hour boundaries. */
export const DEFAULT_FIRST_CONTACT_RULES: FirstContactRules = {
  dueSoonHours: 24,
  overdueHours: 48,
  criticalHours: 72,
};

/** RULE S-1 — locked stage table, business-calendar days. */
export const DEFAULT_STAGE_SLA_RULES: StageSlaRules = {
  new_lead: { targetDays: 2, warningDays: 3, overdueDays: 5, severeDays: 10 },
  contacted: { targetDays: 5, warningDays: 7, overdueDays: 10, severeDays: 21 },
  interested: { targetDays: 5, warningDays: 7, overdueDays: 14, severeDays: 28 },
  proposal: { targetDays: 3, warningDays: 5, overdueDays: 10, severeDays: 21 },
  negotiation: { targetDays: 3, warningDays: 5, overdueDays: 7, severeDays: 14 },
};

export const DEFAULT_STAGE_CLASS_RULES: StageClassRules = {
  churnEligible: ["contacted", "interested", "proposal", "negotiation"],
  highIntent: ["interested", "proposal", "negotiation"],
  postSaleExcluded: ["closed_won", "paid"],
  exempt: ["closed_lost"],
  deferred: ["on_hold"],
};

/** RULE L-3 / L-6 — locked asymmetric counts, 60-day window, decisive outcomes. */
export const DEFAULT_CHURN_RULES: ChurnRules = {
  repeatedNonResponseWindowDays: 60,
  noReplyMinCount: 2,
  noContactMinCount: 3,
  mixedNoReplyMinCount: 1,
  mixedNoContactMinCount: 2,
  noReplyOutcomes: ["no_reply"],
  noContactOutcomes: ["no_contact"],
  decisiveOutcomes: ["lost_contact", "not_interested"],
};

/** RULE G-2 / weight verification — 25+25+12+12+11+3+3+3+3+3 = 100 exactly. */
export const DEFAULT_COMPLETENESS_RULES: CompletenessRules = {
  requiredGroups: ["REQ_IDENTITY", "REQ_REACHABLE"],
  coreGroups: ["CORE_PRIMARY_CHANNEL", "CORE_NEED_CAPTURED", "CORE_CONTEXT"],
  optionalGroups: [
    "OPT_SECOND_CHANNEL",
    "OPT_EMAIL",
    "OPT_PREFERRED_CONTACT",
    "OPT_DEMOGRAPHICS",
    "OPT_PROFESSIONAL",
  ],
  weights: {
    REQ_IDENTITY: 25,
    REQ_REACHABLE: 25,
    CORE_PRIMARY_CHANNEL: 12,
    CORE_NEED_CAPTURED: 12,
    CORE_CONTEXT: 11,
    OPT_SECOND_CHANNEL: 3,
    OPT_EMAIL: 3,
    OPT_PREFERRED_CONTACT: 3,
    OPT_DEMOGRAPHICS: 3,
    OPT_PROFESSIONAL: 3,
  },
};

export const DEFAULT_CUSTOMER_STATE_RULES: CustomerStateRules = {
  ruleVersion: CUSTOMER_STATE_RULE_VERSION,
  firstContact: DEFAULT_FIRST_CONTACT_RULES,
  stageSla: DEFAULT_STAGE_SLA_RULES,
  stageClasses: DEFAULT_STAGE_CLASS_RULES,
  churn: DEFAULT_CHURN_RULES,
  completeness: DEFAULT_COMPLETENESS_RULES,
};

export const CUSTOMER_STATE_RULE_SECTIONS = [
  "ruleVersion",
  "firstContact",
  "stageSla",
  "stageClasses",
  "churn",
  "completeness",
] as const;

export type CustomerStateRuleSection =
  (typeof CUSTOMER_STATE_RULE_SECTIONS)[number];

export type RuleResolutionWarning = {
  section: CustomerStateRuleSection;
  reason: string;
};

export type RuleResolution = {
  rules: CustomerStateRules;
  warnings: RuleResolutionWarning[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.trim().length > 0)
  );
}

function parseFirstContact(value: unknown): FirstContactRules | null {
  if (!isRecord(value)) return null;
  const { dueSoonHours, overdueHours, criticalHours } = value;
  if (
    !isPositiveInt(dueSoonHours) ||
    !isPositiveInt(overdueHours) ||
    !isPositiveInt(criticalHours)
  ) {
    return null;
  }
  if (!(dueSoonHours < overdueHours && overdueHours < criticalHours)) {
    return null;
  }
  return { dueSoonHours, overdueHours, criticalHours };
}

function parseStageSlaRule(value: unknown): StageSlaRule | null {
  if (!isRecord(value)) return null;
  const { targetDays, warningDays, overdueDays, severeDays } = value;
  if (
    !isPositiveInt(targetDays) ||
    !isPositiveInt(warningDays) ||
    !isPositiveInt(overdueDays) ||
    !isPositiveInt(severeDays)
  ) {
    return null;
  }
  // Bands must stay non-empty and ordered, otherwise RULE I-5/I-6 lose meaning.
  if (!(targetDays < overdueDays && overdueDays <= severeDays)) return null;
  if (!(targetDays < warningDays && warningDays <= overdueDays)) return null;
  return { targetDays, warningDays, overdueDays, severeDays };
}

function parseStageSla(value: unknown): StageSlaRules | null {
  if (!isRecord(value)) return null;
  const resolved: Partial<Record<ActiveSlaStage, StageSlaRule>> = {};
  for (const stage of ACTIVE_SLA_STAGES) {
    const parsed = parseStageSlaRule(value[stage]);
    if (!parsed) return null;
    resolved[stage] = parsed;
  }
  return resolved as StageSlaRules;
}

function parseStageList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((entry) => typeof entry === "string" && entry.length > 0)) {
    return null;
  }
  return value as string[];
}

function parseStageClasses(value: unknown): StageClassRules | null {
  if (!isRecord(value)) return null;
  const churnEligible = parseStageList(value.churnEligible);
  const highIntent = parseStageList(value.highIntent);
  const postSaleExcluded = parseStageList(value.postSaleExcluded);
  const exempt = parseStageList(value.exempt);
  const deferred = parseStageList(value.deferred);
  if (
    !churnEligible ||
    !highIntent ||
    !postSaleExcluded ||
    !exempt ||
    !deferred
  ) {
    return null;
  }
  return {
    churnEligible: churnEligible as CanonicalStage[],
    highIntent: highIntent as CanonicalStage[],
    postSaleExcluded: postSaleExcluded as CanonicalStage[],
    exempt: exempt as CanonicalStage[],
    deferred: deferred as CanonicalStage[],
  };
}

function parseChurn(value: unknown): ChurnRules | null {
  if (!isRecord(value)) return null;
  const {
    repeatedNonResponseWindowDays,
    noReplyMinCount,
    noContactMinCount,
    mixedNoReplyMinCount,
    mixedNoContactMinCount,
    noReplyOutcomes,
    noContactOutcomes,
    decisiveOutcomes,
  } = value;
  if (
    !isPositiveInt(repeatedNonResponseWindowDays) ||
    !isPositiveInt(noReplyMinCount) ||
    !isPositiveInt(noContactMinCount) ||
    !isPositiveInt(mixedNoReplyMinCount) ||
    !isPositiveInt(mixedNoContactMinCount)
  ) {
    return null;
  }
  if (
    !isNonEmptyStringArray(noReplyOutcomes) ||
    !isNonEmptyStringArray(noContactOutcomes) ||
    !isNonEmptyStringArray(decisiveOutcomes)
  ) {
    return null;
  }
  return {
    repeatedNonResponseWindowDays,
    noReplyMinCount,
    noContactMinCount,
    mixedNoReplyMinCount,
    mixedNoContactMinCount,
    noReplyOutcomes,
    noContactOutcomes,
    decisiveOutcomes,
  };
}

function parseGroupList(value: unknown): ProfileGroup[] | null {
  if (!Array.isArray(value)) return null;
  const groups: ProfileGroup[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    if (!(PROFILE_GROUPS as readonly string[]).includes(entry)) return null;
    groups.push(entry as ProfileGroup);
  }
  return groups;
}

function parseCompleteness(value: unknown): CompletenessRules | null {
  if (!isRecord(value)) return null;
  const requiredGroups = parseGroupList(value.requiredGroups);
  const coreGroups = parseGroupList(value.coreGroups);
  const optionalGroups = parseGroupList(value.optionalGroups);
  if (!requiredGroups || !coreGroups || !optionalGroups) return null;

  const partition = [...requiredGroups, ...coreGroups, ...optionalGroups];
  if (partition.length !== PROFILE_GROUPS.length) return null;
  if (new Set(partition).size !== PROFILE_GROUPS.length) return null;

  const rawWeights = value.weights;
  if (!isRecord(rawWeights)) return null;
  const weights: Partial<Record<ProfileGroup, number>> = {};
  let total = 0;
  for (const group of PROFILE_GROUPS) {
    const weight = rawWeights[group];
    if (!isNonNegativeInt(weight)) return null;
    weights[group] = weight;
    total += weight;
  }
  // RULE G weight verification — weights MUST total exactly 100.
  if (total !== 100) return null;

  return {
    requiredGroups,
    coreGroups,
    optionalGroups,
    weights: weights as Record<ProfileGroup, number>,
  };
}

/**
 * RULE V-3 — resolve an untrusted `customer_state_rules` payload into a
 * complete rule set. Each top-level section is accepted or replaced by its
 * code default as a whole; no partially applied section is ever produced.
 */
export function resolveCustomerStateRules(input?: unknown): RuleResolution {
  const warnings: RuleResolutionWarning[] = [];

  if (input === undefined || input === null) {
    return { rules: DEFAULT_CUSTOMER_STATE_RULES, warnings };
  }
  if (!isRecord(input)) {
    return {
      rules: DEFAULT_CUSTOMER_STATE_RULES,
      warnings: CUSTOMER_STATE_RULE_SECTIONS.map((section) => ({
        section,
        reason: "customer_state_rules is not an object; using code defaults",
      })),
    };
  }

  const rawVersion = input.ruleVersion;
  let ruleVersion = CUSTOMER_STATE_RULE_VERSION;
  if (rawVersion !== undefined) {
    if (typeof rawVersion === "string" && rawVersion.trim().length > 0) {
      ruleVersion = rawVersion;
    } else {
      warnings.push({
        section: "ruleVersion",
        reason: "ruleVersion is not a non-empty string; using code default",
      });
    }
  }

  const firstContact =
    input.firstContact === undefined
      ? DEFAULT_FIRST_CONTACT_RULES
      : parseFirstContact(input.firstContact);
  if (!firstContact) {
    warnings.push({
      section: "firstContact",
      reason: "invalid firstContact section; using code defaults",
    });
  }

  const stageSla =
    input.stageSla === undefined
      ? DEFAULT_STAGE_SLA_RULES
      : parseStageSla(input.stageSla);
  if (!stageSla) {
    warnings.push({
      section: "stageSla",
      reason: "invalid stageSla section; using code defaults",
    });
  }

  const stageClasses =
    input.stageClasses === undefined
      ? DEFAULT_STAGE_CLASS_RULES
      : parseStageClasses(input.stageClasses);
  if (!stageClasses) {
    warnings.push({
      section: "stageClasses",
      reason: "invalid stageClasses section; using code defaults",
    });
  }

  const churn =
    input.churn === undefined ? DEFAULT_CHURN_RULES : parseChurn(input.churn);
  if (!churn) {
    warnings.push({
      section: "churn",
      reason: "invalid churn section; using code defaults",
    });
  }

  const completeness =
    input.completeness === undefined
      ? DEFAULT_COMPLETENESS_RULES
      : parseCompleteness(input.completeness);
  if (!completeness) {
    warnings.push({
      section: "completeness",
      reason: "invalid completeness section; using code defaults",
    });
  }

  return {
    rules: {
      ruleVersion,
      firstContact: firstContact ?? DEFAULT_FIRST_CONTACT_RULES,
      stageSla: stageSla ?? DEFAULT_STAGE_SLA_RULES,
      stageClasses: stageClasses ?? DEFAULT_STAGE_CLASS_RULES,
      churn: churn ?? DEFAULT_CHURN_RULES,
      completeness: completeness ?? DEFAULT_COMPLETENESS_RULES,
    },
    warnings,
  };
}

export function getStageSlaRule(
  rules: CustomerStateRules,
  stage: ActiveSlaStage,
): StageSlaRule {
  return rules.stageSla[stage];
}

export function isPostSaleStage(
  rules: CustomerStateRules,
  stage: CanonicalStage,
): boolean {
  return rules.stageClasses.postSaleExcluded.includes(stage);
}

export function isExemptStage(
  rules: CustomerStateRules,
  stage: CanonicalStage,
): boolean {
  return rules.stageClasses.exempt.includes(stage);
}

export function isDeferredStage(
  rules: CustomerStateRules,
  stage: CanonicalStage,
): boolean {
  return rules.stageClasses.deferred.includes(stage);
}

export function isChurnEligibleStage(
  rules: CustomerStateRules,
  stage: CanonicalStage,
): boolean {
  return rules.stageClasses.churnEligible.includes(stage);
}

export function isHighIntentStage(
  rules: CustomerStateRules,
  stage: CanonicalStage,
): boolean {
  return rules.stageClasses.highIntent.includes(stage);
}
