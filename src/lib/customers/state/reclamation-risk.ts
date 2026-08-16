/**
 * Reclamation Risk dimension — READ-ONLY REPORTING.
 *
 * Authority: TASK 17-B-R1 §N (RULE N-1..N-6), §S-5, §O-5.
 *
 * RULE N-2 — ABSOLUTE FREEZE. V2 READS and REPORTS the existing ownership
 *            rules. It MUST NOT modify `reclamation/engine.ts` eligibility, the
 *            auto-release CAS predicate, `isPinned` behaviour, the collaborator
 *            exemption, the On Hold pin coupling, excluded-stage behaviour,
 *            `automatic_reclaim_days`, cycle-anchor reset events, or Public Pool
 *            ownership movement. This module therefore delegates every predicate
 *            to the existing production helpers instead of restating them.
 * RULE N-5 — `getDaysWithoutValidFollowUp` is used UNCHANGED. Its hardcoded
 *            `Asia/Hong_Kong` calendar is deliberate (RULE R-E); the V2 helper
 *            honours the settings timezone for the other dimensions only.
 * RULE N-6 — an unknown sales stage MUST NOT suppress genuine reclamation facts.
 */

import type { Customer } from "../../../../drizzle/schema/customers";
import {
  isReclamationEligibleCustomer,
  isReclamationExcludedSalesStage,
} from "@/lib/reclamation/constants";
import { isReclaimGraceActive } from "@/lib/reclamation/cycle";
import { getDaysWithoutValidFollowUp } from "@/lib/reclamation/days";
import {
  reason,
  type ReclamationExemptionCause,
  type StateReason,
} from "./reason-codes";
import type { CustomerStateFacts, ReclamationRiskResult } from "./types";

export type ReclamationRiskEvaluation = {
  result: ReclamationRiskResult;
  reasons: StateReason[];
};

/**
 * RULE N-3 exemption list, evaluated in a fixed order so the single exclusive
 * `RECLAMATION_EXEMPT` code always carries a deterministic cause. `unowned` is
 * checked before the generic `not_active` case because a Public Pool customer
 * satisfies both and `unowned` is the meaningful explanation (RULE S-6).
 */
function resolveExemptionCause(
  facts: CustomerStateFacts,
): ReclamationExemptionCause | null {
  // Existing frozen production predicate: excluded stage OR pinned.
  if (!isReclamationEligibleCustomer(facts)) {
    return isReclamationExcludedSalesStage(facts.salesStage)
      ? "excluded_stage"
      : "pinned";
  }
  if (facts.hasCollaborator) return "collaborator";
  if (facts.ownerId === null || facts.status === "public_pool") return "unowned";
  if (facts.status !== "active") return "not_active";
  return null;
}

/** Narrow view of the fields the frozen reclamation date helpers read. */
type ReclamationIdleCustomer = Pick<
  Customer,
  "reclamationCycleStartedAt" | "lastValidFollowUpAt" | "createdAt"
>;

export function evaluateReclamationRisk(
  facts: CustomerStateFacts,
  now: Date,
): ReclamationRiskEvaluation {
  const cause = resolveExemptionCause(facts);
  if (cause !== null) {
    return {
      result: { state: "exempt", idleDays: null, daysRemaining: null, cause },
      reasons: [reason("RECLAMATION_EXEMPT", "reclamation", { cause })],
    };
  }

  // RULE N-3 — the admin rule-shortening grace period also exempts.
  if (isReclaimGraceActive(facts, now)) {
    return {
      result: {
        state: "exempt",
        idleDays: null,
        daysRemaining: null,
        cause: "rule_grace",
      },
      reasons: [
        reason("RECLAMATION_EXEMPT", "reclamation", { cause: "rule_grace" }),
      ],
    };
  }

  const idleCustomer: ReclamationIdleCustomer = {
    reclamationCycleStartedAt: facts.reclamationCycleStartedAt,
    lastValidFollowUpAt: facts.lastValidFollowUpAt,
    createdAt: facts.createdAt,
  };
  const idleDays = getDaysWithoutValidFollowUp(
    idleCustomer as Customer,
    now,
  );
  const reclaimDays = facts.automaticReclaimDays;
  const daysRemaining = reclaimDays - idleDays;
  const params = { daysRemaining, reclaimDays, idleDays };

  if (idleDays >= reclaimDays) {
    return {
      result: { state: "due", idleDays, daysRemaining, cause: null },
      reasons: [reason("RECLAMATION_DUE", "reclamation", params)],
    };
  }
  if (daysRemaining <= 1) {
    return {
      result: { state: "final", idleDays, daysRemaining, cause: null },
      reasons: [reason("RECLAMATION_FINAL", "reclamation", params)],
    };
  }
  if (daysRemaining <= 7) {
    return {
      result: { state: "warning", idleDays, daysRemaining, cause: null },
      reasons: [reason("RECLAMATION_WARNING", "reclamation", params)],
    };
  }
  if (daysRemaining <= 14) {
    return {
      result: { state: "approaching", idleDays, daysRemaining, cause: null },
      reasons: [reason("RECLAMATION_APPROACHING", "reclamation", params)],
    };
  }
  return {
    result: { state: "none", idleDays, daysRemaining, cause: null },
    reasons: [],
  };
}
