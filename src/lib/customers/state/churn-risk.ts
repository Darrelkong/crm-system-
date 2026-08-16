/**
 * Churn Risk dimension and its three signal families.
 *
 * Authority: TASK 17-B-R1 §K (RULE K-1..K-7), §L (RULE L-1..L-9), §M;
 * TASK 17-B-R2 §C and §E.
 *
 * RULE K-4 — never-contacted isolation is ABSOLUTE. A relationship that never
 *            existed cannot deteriorate, so the short circuit precedes ALL
 *            signal evaluation and no family may appear in the returned state.
 * RULE K-6 — `nextFollowUpAt` MUST NOT appear in any family.
 * RULE L-5 — a family contributes exactly once, whether it fires on 2 records
 *            or 20. `no_reply` and `no_contact` stay inside one family.
 * RULE L-8 — there is no fourth family. Signals the database does not store
 *            MUST NOT be simulated, inferred, or fabricated.
 */

import { reason, type StateReason } from "./reason-codes";
import { isChurnEligibleStage, type CustomerStateRules } from "./rules";
import type { StateScope } from "./scope";
import { getStateCalendarDayDifference, parseStateInstant } from "./time";
import type {
  ChurnFamily,
  ChurnRiskResult,
  CustomerStateFacts,
  EngagementState,
} from "./types";

export type NonResponseTrigger = "no_reply" | "no_contact" | "mixed";

export type ChurnFamilyDetail = {
  familyA: boolean;
  familyB: boolean;
  familyC: boolean;
  noReplyCount: number;
  noContactCount: number;
  nonResponseTrigger: NonResponseTrigger | null;
  lostContactAt: string | null;
  notInterestedAt: string | null;
};

export const EMPTY_CHURN_FAMILY_DETAIL: ChurnFamilyDetail = {
  familyA: false,
  familyB: false,
  familyC: false,
  noReplyCount: 0,
  noContactCount: 0,
  nonResponseTrigger: null,
  lostContactAt: null,
  notInterestedAt: null,
};

/**
 * RULE L-4 / L-7 — supersession. A record counts only when it is strictly after
 * the latest valid interaction. R2 §C makes `parsedLastValidFollowUpAt` the sole
 * supersession anchor, so a malformed timestamp cannot silently admit records
 * (the never-contacted short circuit handles that case instead).
 */
function isAfterSupersessionAnchor(
  followUpTime: Date,
  anchor: Date | null,
): boolean {
  return anchor === null || followUpTime.getTime() > anchor.getTime();
}

/** R2 §E — integer business-calendar lookback; day 60 included, day 61 excluded. */
function isInsideLookback(
  followUpTime: Date,
  now: Date,
  windowDays: number,
  timezone: CustomerStateFacts["businessTimezone"],
): boolean {
  const difference = getStateCalendarDayDifference(followUpTime, now, timezone);
  return difference >= 0 && difference <= windowDays;
}

/** RULE L-1 — Family A: `ENGAGEMENT_DETERIORATION`, non-decisive. */
function evaluateFamilyA(
  rules: CustomerStateRules,
  scope: StateScope,
  engagement: EngagementState,
): boolean {
  if (scope.stage.kind !== "canonical") return false;
  if (!isChurnEligibleStage(rules, scope.stage.stage)) return false;
  if (!scope.hasValidInteractionTimestamp) return false;
  return engagement === "cooling" || engagement === "silent";
}

/** RULE L-3 — Family B: `REPEATED_NON_RESPONSE`, non-decisive, asymmetric counts. */
function evaluateFamilyB(
  facts: CustomerStateFacts,
  rules: CustomerStateRules,
  scope: StateScope,
  now: Date,
): { fired: boolean; noReplyCount: number; noContactCount: number; trigger: NonResponseTrigger | null } {
  const churn = rules.churn;
  let noReplyCount = 0;
  let noContactCount = 0;

  for (const record of facts.followUpOutcomes) {
    const isNoReply = churn.noReplyOutcomes.includes(record.outcome);
    const isNoContact = churn.noContactOutcomes.includes(record.outcome);
    if (!isNoReply && !isNoContact) continue;

    const followUpTime = parseStateInstant(record.followUpTime);
    if (followUpTime === null) continue;
    if (
      !isAfterSupersessionAnchor(followUpTime, scope.parsedLastValidFollowUpAt)
    ) {
      continue;
    }
    if (
      !isInsideLookback(
        followUpTime,
        now,
        churn.repeatedNonResponseWindowDays,
        facts.businessTimezone,
      )
    ) {
      continue;
    }

    if (isNoReply) noReplyCount += 1;
    else noContactCount += 1;
  }

  let trigger: NonResponseTrigger | null = null;
  if (noReplyCount >= churn.noReplyMinCount) {
    trigger = "no_reply";
  } else if (noContactCount >= churn.noContactMinCount) {
    trigger = "no_contact";
  } else if (
    noReplyCount >= churn.mixedNoReplyMinCount &&
    noContactCount >= churn.mixedNoContactMinCount
  ) {
    trigger = "mixed";
  }

  return { fired: trigger !== null, noReplyCount, noContactCount, trigger };
}

/** RULE L-6/L-7 — Family C: `EXPLICIT_NEGATIVE_CUSTOMER_SIGNAL`, decisive, no window. */
function evaluateFamilyC(
  facts: CustomerStateFacts,
  rules: CustomerStateRules,
  scope: StateScope,
): { fired: boolean; lostContactAt: string | null; notInterestedAt: string | null } {
  let lostContactAt: string | null = null;
  let notInterestedAt: string | null = null;

  for (const record of facts.followUpOutcomes) {
    if (!rules.churn.decisiveOutcomes.includes(record.outcome)) continue;

    const followUpTime = parseStateInstant(record.followUpTime);
    if (followUpTime === null) continue;
    if (
      !isAfterSupersessionAnchor(followUpTime, scope.parsedLastValidFollowUpAt)
    ) {
      continue;
    }

    const recordedAt = followUpTime.toISOString();
    if (record.outcome === "lost_contact") {
      if (lostContactAt === null || recordedAt > lostContactAt) {
        lostContactAt = recordedAt;
      }
    } else if (record.outcome === "not_interested") {
      if (notInterestedAt === null || recordedAt > notInterestedAt) {
        notInterestedAt = recordedAt;
      }
    }
  }

  return {
    fired: lostContactAt !== null || notInterestedAt !== null,
    lostContactAt,
    notInterestedAt,
  };
}

export function evaluateChurnFamilies(
  facts: CustomerStateFacts,
  rules: CustomerStateRules,
  scope: StateScope,
  engagement: EngagementState,
  now: Date,
): ChurnFamilyDetail {
  const familyB = evaluateFamilyB(facts, rules, scope, now);
  const familyC = evaluateFamilyC(facts, rules, scope);
  return {
    familyA: evaluateFamilyA(rules, scope, engagement),
    familyB: familyB.fired,
    familyC: familyC.fired,
    noReplyCount: familyB.noReplyCount,
    noContactCount: familyB.noContactCount,
    nonResponseTrigger: familyB.trigger,
    lostContactAt: familyC.lostContactAt,
    notInterestedAt: familyC.notInterestedAt,
  };
}

export type ChurnRiskEvaluation = {
  result: ChurnRiskResult;
  reasons: StateReason[];
  detail: ChurnFamilyDetail;
};

function notApplicable(
  result: ChurnRiskResult,
  reasons: StateReason[],
): ChurnRiskEvaluation {
  return { result, reasons, detail: EMPTY_CHURN_FAMILY_DETAIL };
}

export function evaluateChurnRisk(
  facts: CustomerStateFacts,
  rules: CustomerStateRules,
  scope: StateScope,
  engagement: EngagementState,
  now: Date,
): ChurnRiskEvaluation {
  const none: ChurnRiskResult = { level: "low", families: [] };

  // RULE K-3 step 1.
  if (scope.isPostSale) {
    return notApplicable(none, [
      reason("CHURN_NOT_APPLICABLE_POST_SALE", "churn", {
        stage: scope.stage.kind === "canonical" ? scope.stage.stage : null,
      }),
    ]);
  }
  // RULE K-3 step 2.
  if (scope.isClosedLost) {
    return notApplicable(none, [
      reason("CHURN_NOT_APPLICABLE_CLOSED_LOST", "churn"),
    ]);
  }
  // RULE K-3 step 3.
  if (scope.isStageUnknown) {
    return notApplicable(none, [
      reason("CHURN_NOT_APPLICABLE_STAGE_UNKNOWN", "churn", {
        value: scope.stage.rawValue,
      }),
    ]);
  }
  // RULE K-3 step 4.
  if (scope.isUnowned) {
    return notApplicable(none, [
      reason("CHURN_NOT_APPLICABLE_UNOWNED", "churn"),
    ]);
  }
  // RULE K-3 step 5 / K-4 — absolute never-contacted isolation, evaluated
  // BEFORE any family so no family can appear in the returned state.
  if (!scope.hasValidInteractionTimestamp) {
    return notApplicable(none, [
      reason("CHURN_NOT_APPLICABLE_NO_PRIOR_ENGAGEMENT", "churn"),
    ]);
  }

  const detail = evaluateChurnFamilies(facts, rules, scope, engagement, now);

  const families: ChurnFamily[] = [];
  if (detail.familyA) families.push("ENGAGEMENT_DETERIORATION");
  if (detail.familyB) families.push("REPEATED_NON_RESPONSE");
  if (detail.familyC) families.push("EXPLICIT_NEGATIVE_CUSTOMER_SIGNAL");

  const familyReasons: StateReason[] = [];
  if (detail.familyA) {
    familyReasons.push(
      reason("CHURN_ENGAGEMENT_DETERIORATION", "churn", {
        stage: scope.stage.kind === "canonical" ? scope.stage.stage : null,
        engagement,
      }),
    );
  }
  if (detail.familyB) {
    familyReasons.push(
      reason("CHURN_REPEATED_NON_RESPONSE", "churn", {
        noReplyCount: detail.noReplyCount,
        noContactCount: detail.noContactCount,
        windowDays: rules.churn.repeatedNonResponseWindowDays,
        triggeredBy: detail.nonResponseTrigger,
      }),
    );
  }
  if (detail.lostContactAt !== null) {
    familyReasons.push(
      reason("CHURN_LOST_CONTACT", "churn", {
        recordedAt: detail.lostContactAt,
      }),
    );
  }
  if (detail.notInterestedAt !== null) {
    familyReasons.push(
      reason("CHURN_NOT_INTERESTED", "churn", {
        recordedAt: detail.notInterestedAt,
      }),
    );
  }

  const nonDecisiveCount = (detail.familyA ? 1 : 0) + (detail.familyB ? 1 : 0);

  // RULE K-3 step 6 / K-5 — a decisive signal outranks deferral.
  if (detail.familyC) {
    return { result: { level: "high", families }, reasons: familyReasons, detail };
  }
  // RULE K-3 step 7 / L-9 — two independent non-decisive families.
  if (nonDecisiveCount >= 2) {
    return { result: { level: "high", families }, reasons: familyReasons, detail };
  }
  // RULE K-3 step 8 / K-5 — deferred customers never reach `medium` on staleness.
  // Detected families stay reported for diagnostics; only the LEVEL is
  // suppressed, and `CHURN_DEFERRED` is the reason that explains why.
  if (scope.isDeferred) {
    return {
      result: { level: "low", families },
      reasons: [reason("CHURN_DEFERRED", "churn")],
      detail,
    };
  }
  // RULE K-3 step 9.
  if (nonDecisiveCount === 1) {
    return { result: { level: "medium", families }, reasons: familyReasons, detail };
  }
  // RULE K-3 step 10 — applicable and clean; R2 §B allows zero reasons here.
  return { result: { level: "low", families }, reasons: [], detail };
}
