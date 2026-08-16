/**
 * Attention Level dimension — TERMINAL OUTPUT.
 *
 * Authority: TASK 17-B-R1 §P (RULE P-1..P-6), §S-4, §X-9.
 *
 * RULE P-3 — stage MAY act only as a tie-breaker for ordering WITHIN a level.
 *            Stage MUST NOT by itself promote a customer to a higher level.
 * RULE P-5 — under an unknown stage, Attention is derived from the remaining
 *            valid dimensions; reclamation facts MUST still be able to escalate.
 * RULE P-6 — Attention MUST NOT be an input to any other dimension.
 */

import { reason, type StateReason } from "./reason-codes";
import { isHighIntentStage, type CustomerStateRules } from "./rules";
import type { StateScope } from "./scope";
import type {
  AttentionLevelResult,
  ChurnLevel,
  FirstContactState,
  FollowUpSlaState,
  ReclamationRiskState,
} from "./types";

/** RULE P-3 — ordering hint within a level. Never affects the level itself. */
export const ATTENTION_STAGE_TIE_BREAK_ORDER = [
  "negotiation",
  "proposal",
  "interested",
  "contacted",
  "new_lead",
] as const;

export type AttentionInputs = {
  firstContact: FirstContactState;
  followUpSla: FollowUpSlaState;
  reclamationRisk: ReclamationRiskState;
  churnRisk: ChurnLevel;
  /** RULE I-6 — emitted by the SLA dimension while `due_soon`. */
  slaWarningReached: boolean;
};

export type AttentionLevelEvaluation = {
  result: AttentionLevelResult;
  reasons: StateReason[];
};

export function evaluateAttentionLevel(
  rules: CustomerStateRules,
  scope: StateScope,
  inputs: AttentionInputs,
): AttentionLevelEvaluation {
  const stage = scope.stage.kind === "canonical" ? scope.stage.stage : null;
  const highIntent = stage !== null && isHighIntentStage(rules, stage);

  // RULE P-2 — `urgent`.
  const urgent: StateReason[] = [];
  if (inputs.firstContact === "critical") {
    urgent.push(reason("ATTENTION_URGENT_FIRST_CONTACT", "attention"));
  }
  if (inputs.followUpSla === "severe_overdue") {
    urgent.push(reason("ATTENTION_URGENT_SLA_SEVERE", "attention"));
  }
  if (inputs.reclamationRisk === "final" || inputs.reclamationRisk === "due") {
    urgent.push(
      reason("ATTENTION_URGENT_RECLAMATION", "attention", {
        state: inputs.reclamationRisk,
      }),
    );
  }
  if (inputs.churnRisk === "high") {
    urgent.push(reason("ATTENTION_URGENT_CHURN", "attention"));
  }
  if (urgent.length > 0) {
    return { result: { level: "urgent" }, reasons: urgent };
  }

  // RULE P-2 — `high`.
  const high: StateReason[] = [];
  if (inputs.firstContact === "overdue") {
    high.push(reason("ATTENTION_HIGH_FIRST_CONTACT", "attention"));
  }
  if (inputs.followUpSla === "overdue") {
    high.push(reason("ATTENTION_HIGH_SLA_OVERDUE", "attention"));
  }
  if (inputs.reclamationRisk === "warning") {
    high.push(reason("ATTENTION_HIGH_RECLAMATION", "attention"));
  }
  if (inputs.churnRisk === "medium" && highIntent) {
    high.push(
      reason("ATTENTION_HIGH_CHURN_HIGH_INTENT", "attention", { stage }),
    );
  }
  if (inputs.slaWarningReached) {
    high.push(reason("ATTENTION_HIGH_SLA_WARNING", "attention"));
  }
  if (high.length > 0) {
    return { result: { level: "high" }, reasons: high };
  }

  // RULE P-2 — `normal`.
  const normal: StateReason[] = [];
  if (inputs.firstContact === "due_soon") {
    normal.push(reason("ATTENTION_NORMAL_FIRST_CONTACT", "attention"));
  }
  if (inputs.followUpSla === "due_soon") {
    normal.push(reason("ATTENTION_NORMAL_SLA_DUE_SOON", "attention"));
  }
  if (inputs.reclamationRisk === "approaching") {
    normal.push(reason("ATTENTION_NORMAL_RECLAMATION", "attention"));
  }
  if (inputs.churnRisk === "medium" && !highIntent) {
    normal.push(reason("ATTENTION_NORMAL_CHURN", "attention", { stage }));
  }
  if (normal.length > 0) {
    return { result: { level: "normal" }, reasons: normal };
  }

  // RULE P-2 / P-4 — `low`, including every deferred and exempt combination
  // with no listed trigger. R2 §B: the upstream exemption or non-applicability
  // reason already explains it, so no healthy-state code is invented here.
  return { result: { level: "low" }, reasons: [] };
}
