/**
 * Engagement Health dimension.
 *
 * Authority: TASK 17-B-R1 §J (RULE J-1..J-6).
 *
 * RULE J-2 — Engagement Health MUST NOT read reclamation thresholds, the
 *            ownership countdown, `isPinned`, or `nextFollowUpAt`. Only the
 *            `exempt` and `deferred` short-circuits couple it to anything.
 * RULE J-5 — `not_started` is first-class and MUST NEVER be folded into
 *            `silent`. This is the TASK 17-A defect where all 43 `silent`
 *            customers had in fact never been contacted.
 */

import { reason, type StateReason } from "./reason-codes";
import { getStageSlaRule, type CustomerStateRules } from "./rules";
import type { StateScope } from "./scope";
import { isActiveSlaStage } from "./stages";
import type { EngagementHealthResult } from "./types";

export type EngagementHealthEvaluation = {
  result: EngagementHealthResult;
  reasons: StateReason[];
};

export function evaluateEngagementHealth(
  rules: CustomerStateRules,
  scope: StateScope,
): EngagementHealthEvaluation {
  const daysSinceValidInteraction = scope.daysSinceValidInteraction;

  // RULE J-3 step 1.
  if (scope.exemptionCause !== null) {
    return {
      result: {
        state: "exempt",
        daysSinceValidInteraction,
        cause: scope.exemptionCause,
      },
      reasons: [
        reason("ENGAGEMENT_EXEMPT", "engagement", {
          cause: scope.exemptionCause,
        }),
      ],
    };
  }

  // RULE J-3 step 2 — DEFERRAL_ON_HOLD is emitted once by the engine.
  if (scope.isDeferred) {
    return {
      result: { state: "deferred", daysSinceValidInteraction, cause: null },
      reasons: [],
    };
  }

  // RULE J-3 step 3 — R2 §C: malformed behaves exactly like absent.
  if (daysSinceValidInteraction === null) {
    return {
      result: {
        state: "not_started",
        daysSinceValidInteraction: null,
        cause: null,
      },
      reasons: [reason("ENGAGEMENT_NOT_STARTED", "engagement")],
    };
  }

  const stage = scope.stage.kind === "canonical" ? scope.stage.stage : null;
  if (stage === null || !isActiveSlaStage(stage)) {
    return {
      result: {
        state: "exempt",
        daysSinceValidInteraction,
        cause: "stage_unknown",
      },
      reasons: [
        reason("ENGAGEMENT_EXEMPT", "engagement", { cause: "stage_unknown" }),
      ],
    };
  }

  // RULE J-4 — bands mirror the SLA bands because they measure the same clock.
  const { targetDays, overdueDays, severeDays } = getStageSlaRule(rules, stage);

  if (daysSinceValidInteraction >= severeDays) {
    return {
      result: { state: "silent", daysSinceValidInteraction, cause: null },
      reasons: [
        reason("ENGAGEMENT_SILENT", "engagement", {
          daysSinceValid: daysSinceValidInteraction,
          severe: severeDays,
        }),
      ],
    };
  }
  if (daysSinceValidInteraction >= overdueDays) {
    return {
      result: { state: "cooling", daysSinceValidInteraction, cause: null },
      reasons: [
        reason("ENGAGEMENT_COOLING", "engagement", {
          daysSinceValid: daysSinceValidInteraction,
        }),
      ],
    };
  }
  if (daysSinceValidInteraction > targetDays) {
    return {
      result: { state: "stable", daysSinceValidInteraction, cause: null },
      reasons: [
        reason("ENGAGEMENT_STABLE", "engagement", {
          daysSinceValid: daysSinceValidInteraction,
        }),
      ],
    };
  }
  return {
    result: { state: "active", daysSinceValidInteraction, cause: null },
    reasons: [],
  };
}
