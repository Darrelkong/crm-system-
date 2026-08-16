/**
 * First Contact dimension.
 *
 * Authority: TASK 17-B-R1 §H (RULE H-1..H-7), §R-A, §R-D;
 * TASK 17-B-R2 §C.
 *
 * RULE H-1 — First Contact describes STAFF OPERATIONAL HANDLING and MUST NOT
 *            contribute to Churn Risk.
 * RULE H-7 — an invalid-outcome follow-up attempt MUST NOT satisfy it.
 */

import { reason, type StateReason } from "./reason-codes";
import type { CustomerStateRules } from "./rules";
import type { StateScope } from "./scope";
import { hasStateText } from "./text";
import { getElapsedHours, parseStateInstant } from "./time";
import type { CustomerStateFacts, FirstContactResult } from "./types";

export type FirstContactEvaluation = {
  result: FirstContactResult;
  reasons: StateReason[];
};

export function evaluateFirstContact(
  facts: CustomerStateFacts,
  rules: CustomerStateRules,
  scope: StateScope,
  now: Date,
): FirstContactEvaluation {
  // RULE H-5 steps 1–4.
  if (scope.exemptionCause !== null) {
    return {
      result: {
        state: "exempt",
        anchorAt: null,
        ageHours: null,
        cause: scope.exemptionCause,
      },
      reasons: [
        reason("FIRST_CONTACT_EXEMPT", "first_contact", {
          cause: scope.exemptionCause,
        }),
      ],
    };
  }

  // RULE H-5 step 5 — On Hold. DEFERRAL_ON_HOLD is emitted once by the engine.
  if (scope.isDeferred) {
    return {
      result: { state: "deferred", anchorAt: null, ageHours: null, cause: null },
      reasons: [],
    };
  }

  // RULE H-2 / H-5 step 6.
  if (scope.hasValidInteractionTimestamp) {
    return {
      result: {
        state: "not_applicable",
        anchorAt: null,
        ageHours: null,
        cause: null,
      },
      reasons: [reason("FIRST_CONTACT_NOT_APPLICABLE", "first_contact")],
    };
  }

  // RULE H-3 — anchor = COALESCE(reclamationCycleStartedAt, createdAt).
  // Selection is by presence; parsing happens afterwards so that a present but
  // malformed cycle anchor is reported as unparseable rather than silently
  // falling back to `createdAt` and inheriting the wrong clock (RULE R-D).
  const anchorIsReassigned = hasStateText(facts.reclamationCycleStartedAt);
  const rawAnchor = anchorIsReassigned
    ? facts.reclamationCycleStartedAt
    : facts.createdAt;
  const anchor = parseStateInstant(rawAnchor);

  // RULE R-D — an unparseable anchor yields `normal`, never NaN and never a throw.
  if (anchor === null) {
    return {
      result: { state: "normal", anchorAt: null, ageHours: null, cause: null },
      reasons: [
        reason("FIRST_CONTACT_ANCHOR_UNPARSEABLE", "first_contact", {
          raw: typeof rawAnchor === "string" ? rawAnchor : null,
        }),
      ],
    };
  }

  const anchorAt = anchor.toISOString();
  const ageHours = getElapsedHours(anchor, now);
  const reasons: StateReason[] = [];

  if (anchorIsReassigned) {
    reasons.push(
      reason("FIRST_CONTACT_ANCHOR_REASSIGNED", "first_contact", { anchorAt }),
    );
  }

  // RULE H-4 — upper edges inclusive.
  const { dueSoonHours, overdueHours, criticalHours } = rules.firstContact;
  if (ageHours <= dueSoonHours) {
    return {
      result: { state: "normal", anchorAt, ageHours, cause: null },
      reasons,
    };
  }
  if (ageHours <= overdueHours) {
    reasons.push(
      reason("FIRST_CONTACT_DUE_SOON", "first_contact", { ageHours, anchorAt }),
    );
    return {
      result: { state: "due_soon", anchorAt, ageHours, cause: null },
      reasons,
    };
  }
  if (ageHours <= criticalHours) {
    reasons.push(
      reason("FIRST_CONTACT_OVERDUE", "first_contact", { ageHours, anchorAt }),
    );
    return {
      result: { state: "overdue", anchorAt, ageHours, cause: null },
      reasons,
    };
  }
  reasons.push(
    reason("FIRST_CONTACT_CRITICAL", "first_contact", { ageHours, anchorAt }),
  );
  return {
    result: { state: "critical", anchorAt, ageHours, cause: null },
    reasons,
  };
}
