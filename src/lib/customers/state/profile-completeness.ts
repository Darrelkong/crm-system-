/**
 * Profile Completeness dimension.
 *
 * Authority: TASK 17-B-R1 §G (RULE G-1..G-7).
 *
 * RULE G-1 — answers only "how complete is the CRM Customer record?". It reads
 *            no owner, follow-up, `nextFollowUpAt`, churn, or reclamation fact;
 *            the nested `CustomerProfileFacts` type makes that structural.
 * RULE G-2 — `NOT NULL`-with-default fields (`source`, `customerType`,
 *            `phoneCountryCode`, `salesStage`) measure nothing and are unscored.
 * RULE G-6 — Public Pool customers use exactly these rules; there is no
 *            90-point ceiling and `complete`/100 is reachable.
 */

import type { CompletenessRules } from "./rules";
import { reason, type StateReason } from "./reason-codes";
import { anyPresent, countPresent, hasStateText } from "./text";
import type {
  CustomerProfileFacts,
  ProfileCompletenessResult,
  ProfileGroup,
} from "./types";

const CONFIRMED_NAME_STATUS = "confirmed";

/** RULE G-3 — group predicates. Emptiness is null or ECMAScript-whitespace-only. */
export function evaluateProfileGroups(
  profile: CustomerProfileFacts,
): Record<ProfileGroup, boolean> {
  return {
    REQ_IDENTITY:
      hasStateText(profile.customerName) &&
      profile.nameStatus?.trim() === CONFIRMED_NAME_STATUS,
    REQ_REACHABLE: anyPresent(profile.phone, profile.wechatId, profile.email),
    CORE_PRIMARY_CHANNEL: anyPresent(profile.phone, profile.wechatId),
    CORE_NEED_CAPTURED: anyPresent(
      profile.requestedProjectCode,
      profile.primaryConcern,
    ),
    CORE_CONTEXT: anyPresent(profile.notes, profile.targetCountryOrRegion),
    OPT_SECOND_CHANNEL:
      countPresent(profile.phone, profile.wechatId, profile.email) >= 2,
    OPT_EMAIL: hasStateText(profile.email),
    OPT_PREFERRED_CONTACT: hasStateText(profile.preferredContactMethod),
    OPT_DEMOGRAPHICS: anyPresent(
      profile.preferredName,
      profile.gender,
      profile.ageRange,
      profile.preferredLanguage,
    ),
    OPT_PROFESSIONAL: anyPresent(
      profile.occupation,
      profile.companyName,
      profile.jobTitle,
    ),
  };
}

const CORE_GROUP_REASON_CODES = {
  CORE_PRIMARY_CHANNEL: "PROFILE_CORE_PRIMARY_CHANNEL_MISSING",
  CORE_NEED_CAPTURED: "PROFILE_CORE_NEED_NOT_CAPTURED",
  CORE_CONTEXT: "PROFILE_CORE_CONTEXT_MISSING",
} as const;

export type ProfileCompletenessEvaluation = {
  result: ProfileCompletenessResult;
  reasons: StateReason[];
};

export function evaluateProfileCompleteness(
  profile: CustomerProfileFacts,
  rules: CompletenessRules,
): ProfileCompletenessEvaluation {
  const met = evaluateProfileGroups(profile);

  let score = 0;
  const missingGroups: ProfileGroup[] = [];
  for (const group of [
    ...rules.requiredGroups,
    ...rules.coreGroups,
    ...rules.optionalGroups,
  ]) {
    if (met[group]) {
      score += rules.weights[group];
    } else {
      missingGroups.push(group);
    }
  }

  const missingRequired = rules.requiredGroups.filter((group) => !met[group]);
  const missingCore = rules.coreGroups.filter((group) => !met[group]);
  const missingOptional = rules.optionalGroups.filter((group) => !met[group]);

  // RULE G-4 — strict precedence, first match wins, exhaustive.
  const verdict =
    missingRequired.length > 0
      ? "critical_gaps"
      : missingCore.length >= 2
        ? "incomplete"
        : missingCore.length === 1 || missingOptional.length >= 1
          ? "minor_gaps"
          : "complete";

  const reasons: StateReason[] = [];
  if (!met.REQ_IDENTITY && rules.requiredGroups.includes("REQ_IDENTITY")) {
    reasons.push(
      reason("PROFILE_REQUIRED_IDENTITY_MISSING", "profile", {
        nameStatus: profile.nameStatus ?? null,
      }),
    );
  }
  if (!met.REQ_REACHABLE && rules.requiredGroups.includes("REQ_REACHABLE")) {
    reasons.push(reason("PROFILE_REQUIRED_CONTACT_MISSING", "profile"));
  }
  for (const group of missingCore) {
    const code = CORE_GROUP_REASON_CODES[group as keyof typeof CORE_GROUP_REASON_CODES];
    if (code) reasons.push(reason(code, "profile"));
  }
  if (missingOptional.length > 0) {
    reasons.push(
      reason("PROFILE_OPTIONAL_GAPS", "profile", { groups: missingOptional }),
    );
  }

  return {
    result: { verdict, score, missingGroups },
    reasons,
  };
}
