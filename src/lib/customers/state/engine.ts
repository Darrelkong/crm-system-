/**
 * Canonical Customer State Engine V2 evaluator.
 *
 * Authority: TASK 17-B-R1 §F (RULE F-1..F-6), §X-9; TASK 17-B-R2.
 *
 * RULE F-1 — exactly ONE canonical evaluator. Pure, synchronous, stateless,
 *            side-effect free, single injected `now`.
 * RULE F-6 — NO transition-dependent output. The signature deliberately exposes
 *            no previous `CustomerState`, no previous sales stage, and no
 *            transition event, which is why `DEFERRAL_ENDED` cannot and does
 *            not exist (RULE O-6, Q-5).
 * RULE R-0 — this module never calls `new Date()`.
 * RULE X-9 — the only permitted inter-dimension dependencies are Churn reading
 *            Engagement state, and Attention reading First Contact, SLA,
 *            Reclamation, Churn, and `SLA_WARNING_REACHED`.
 *
 * TASK 17-C1: this engine is intentionally UNUSED by production. No consumer
 * imports it, no route calls it, and no output changes.
 */

import { evaluateAttentionLevel } from "./attention-level";
import { evaluateChurnRisk } from "./churn-risk";
import { evaluateEngagementHealth } from "./engagement-health";
import { evaluateFirstContact } from "./first-contact";
import { evaluateFollowUpSla } from "./follow-up-sla";
import { evaluateProfileCompleteness } from "./profile-completeness";
import { reason, type StateReason } from "./reason-codes";
import { evaluateReclamationRisk } from "./reclamation-risk";
import type { CustomerStateRules } from "./rules";
import { resolveStateScope } from "./scope";
import type { CustomerState, CustomerStateFacts } from "./types";

/**
 * All three arguments are REQUIRED. `now` has no default because RULE R-0
 * demands an explicitly injected instant, and `rules` has no default because
 * the caller owns rule resolution (`resolveCustomerStateRules`) — a silent
 * fallback here would hide a settings failure inside the pure evaluator.
 */
export function computeCustomerState(
  facts: CustomerStateFacts,
  rules: CustomerStateRules,
  now: Date,
): CustomerState {
  const scope = resolveStateScope(facts, rules, now);
  const reasons: StateReason[] = [];

  // RULE S-4 / Q-0 — emitted exactly once per evaluation.
  if (scope.isStageUnknown) {
    reasons.push(
      reason("STATE_STAGE_UNKNOWN", "engine", { value: scope.stage.rawValue }),
    );
  }

  // RULE O-4 — one DEFERRAL_ON_HOLD explains the deferral of First Contact,
  // SLA, and Engagement simultaneously; the registry lists it once.
  if (scope.isDeferred) {
    reasons.push(reason("DEFERRAL_ON_HOLD", "deferral"));
  }

  const profile = evaluateProfileCompleteness(
    facts.profile,
    rules.completeness,
  );
  reasons.push(...profile.reasons);

  const firstContact = evaluateFirstContact(facts, rules, scope, now);
  reasons.push(...firstContact.reasons);

  const sla = evaluateFollowUpSla(facts, rules, scope, now);
  reasons.push(...sla.reasons);

  const engagement = evaluateEngagementHealth(rules, scope);
  reasons.push(...engagement.reasons);

  const churn = evaluateChurnRisk(
    facts,
    rules,
    scope,
    engagement.result.state,
    now,
  );
  reasons.push(...churn.reasons);

  const reclamation = evaluateReclamationRisk(facts, now);
  reasons.push(...reclamation.reasons);

  const attention = evaluateAttentionLevel(rules, scope, {
    firstContact: firstContact.result.state,
    followUpSla: sla.result.state,
    reclamationRisk: reclamation.result.state,
    churnRisk: churn.result.level,
    slaWarningReached: sla.warningReached,
  });
  reasons.push(...attention.reasons);

  return {
    profileCompleteness: profile.result,
    firstContact: firstContact.result,
    followUpSla: sla.result,
    engagementHealth: engagement.result,
    churnRisk: churn.result,
    reclamationRisk: reclamation.result,
    attentionLevel: attention.result,
    reasons,
    ruleVersion: rules.ruleVersion,
    evaluatedAt: now.toISOString(),
  };
}
