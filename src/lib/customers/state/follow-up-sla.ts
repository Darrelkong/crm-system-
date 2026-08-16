/**
 * Follow-up SLA dimension.
 *
 * Authority: TASK 17-B-R1 §I (RULE I-1..I-8), §S-1; TASK 17-B-R2 §D.
 *
 * RULE I-2  — `appointment_scheduled` does not exist; a FUTURE `nextFollowUpAt`
 *             has no effect at all. Only a passed one does.
 * RULE I-4a — the `nextFollowUpAt` check is deliberately LAST so stage cadence
 *             always wins when it is more severe. A passed next action caps at
 *             `due_soon` and can never soften `overdue` / `severe_overdue`.
 */

import { reason, type StateReason } from "./reason-codes";
import { getStageSlaRule, type CustomerStateRules } from "./rules";
import type { StateScope } from "./scope";
import { isActiveSlaStage } from "./stages";
import { computeEffectiveDueAt, computeStageDueAt } from "./time";
import type { CustomerStateFacts, FollowUpSlaResult } from "./types";

export type FollowUpSlaEvaluation = {
  result: FollowUpSlaResult;
  reasons: StateReason[];
  /** RULE I-6 — Attention escalates to `high` when this is true (RULE P-2). */
  warningReached: boolean;
};

/** R2 §D — `not_started`, `deferred`, and `exempt` carry no due dates. */
const NO_DUE_DATES = { stageDueAt: null, effectiveDueAt: null } as const;

export function evaluateFollowUpSla(
  facts: CustomerStateFacts,
  rules: CustomerStateRules,
  scope: StateScope,
  now: Date,
): FollowUpSlaEvaluation {
  const daysSinceValidInteraction = scope.daysSinceValidInteraction;

  // RULE I-4 steps 1–4.
  if (scope.exemptionCause !== null) {
    return {
      result: {
        state: "exempt",
        daysSinceValidInteraction,
        ...NO_DUE_DATES,
        cause: scope.exemptionCause,
      },
      reasons: [reason("SLA_EXEMPT", "sla", { cause: scope.exemptionCause })],
      warningReached: false,
    };
  }

  // RULE I-4 step 5 — On Hold. DEFERRAL_ON_HOLD is emitted once by the engine.
  if (scope.isDeferred) {
    return {
      result: {
        state: "deferred",
        daysSinceValidInteraction,
        ...NO_DUE_DATES,
        cause: null,
      },
      reasons: [],
      warningReached: false,
    };
  }

  // RULE I-4 step 6 — R2 §C: malformed `lastValidFollowUpAt` behaves as absent.
  const lastValid = scope.parsedLastValidFollowUpAt;
  if (lastValid === null || daysSinceValidInteraction === null) {
    return {
      result: {
        state: "not_started",
        daysSinceValidInteraction: null,
        ...NO_DUE_DATES,
        cause: null,
      },
      reasons: [reason("SLA_NOT_STARTED", "sla")],
      warningReached: false,
    };
  }

  // Only a recognised active stage has a cadence row. Unknown stages already
  // exited above via `stage_unknown`; `on_hold`/post-sale/`closed_lost` too.
  const stage = scope.stage.kind === "canonical" ? scope.stage.stage : null;
  if (stage === null || !isActiveSlaStage(stage)) {
    return {
      result: {
        state: "exempt",
        daysSinceValidInteraction,
        ...NO_DUE_DATES,
        cause: "stage_unknown",
      },
      reasons: [reason("SLA_EXEMPT", "sla", { cause: "stage_unknown" })],
      warningReached: false,
    };
  }

  const thresholds = getStageSlaRule(rules, stage);
  const { targetDays, warningDays, overdueDays, severeDays } = thresholds;

  // R2 §D — calendar-derived due dates, aligned with the cadence boundary.
  const stageDueInstant = computeStageDueAt(
    lastValid,
    targetDays,
    facts.businessTimezone,
  );
  const stageDueAt = stageDueInstant.toISOString();
  const nextAction = scope.parsedNextFollowUpAt;
  const effectiveDueAt = computeEffectiveDueAt(
    stageDueInstant,
    nextAction,
  ).toISOString();

  const reasons: StateReason[] = [];
  if (daysSinceValidInteraction > targetDays) {
    reasons.push(
      reason("SLA_STAGE_TARGET_EXCEEDED", "sla", {
        stage,
        daysSinceValid: daysSinceValidInteraction,
        target: targetDays,
      }),
    );
  }

  // RULE I-4 step 10 / I-8 — a PASSED next action. `nextFollowUpAt == now` is
  // not overdue (strict `<`, RULE R-C). Reported whenever stage cadence is
  // evaluated, so consumers can distinguish a missed planned action from a
  // cadence breach; it never changes severity beyond step 10.
  const nextActionOverdue =
    nextAction !== null && nextAction.getTime() < now.getTime();
  if (nextAction !== null && nextActionOverdue) {
    reasons.push(
      reason("SLA_NEXT_ACTION_OVERDUE", "sla", {
        nextFollowUpAt: nextAction.toISOString(),
      }),
    );
  }

  const base = { daysSinceValidInteraction, stageDueAt, effectiveDueAt, cause: null };

  // RULE I-4 step 7 / I-5.
  if (daysSinceValidInteraction >= severeDays) {
    reasons.push(
      reason("SLA_OVERDUE_SEVERE", "sla", {
        severe: severeDays,
        daysSinceValid: daysSinceValidInteraction,
      }),
    );
    return {
      result: { state: "severe_overdue", ...base },
      reasons,
      warningReached: false,
    };
  }

  // RULE I-4 step 8.
  if (daysSinceValidInteraction >= overdueDays) {
    reasons.push(
      reason("SLA_OVERDUE", "sla", {
        overdue: overdueDays,
        daysSinceValid: daysSinceValidInteraction,
      }),
    );
    return {
      result: { state: "overdue", ...base },
      reasons,
      warningReached: false,
    };
  }

  // RULE I-4 step 9 + RULE I-6 — Warning creates no state of its own.
  if (daysSinceValidInteraction > targetDays) {
    const warningReached = daysSinceValidInteraction >= warningDays;
    if (warningReached) {
      reasons.push(
        reason("SLA_WARNING_REACHED", "sla", {
          warning: warningDays,
          daysSinceValid: daysSinceValidInteraction,
        }),
      );
    }
    return { result: { state: "due_soon", ...base }, reasons, warningReached };
  }

  // RULE I-4 step 10 — cadence is on track but the planned action has passed.
  if (nextActionOverdue) {
    return { result: { state: "due_soon", ...base }, reasons, warningReached: false };
  }

  // RULE I-4 step 11.
  return { result: { state: "on_track", ...base }, reasons, warningReached: false };
}
