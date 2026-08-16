/**
 * Shared scope resolution used by the stage-driven dimensions.
 *
 * Authority: TASK 17-B-R1 §H-5 / §I-4 / §J-3 / §K-3 (identical steps 1–4),
 * §S-4 (unknown-stage fail-safe), §S-6 (unowned short-circuit),
 * TASK 17-B-R2 §C (one valid-interaction-timestamp concept).
 *
 * This module derives NOTHING that a dimension is forbidden to read. It only
 * resolves values that First Contact, SLA, Engagement, and Churn each need
 * identically, so the four dimensions cannot drift apart in their precedence.
 */

import type { StateExemptionCause } from "./reason-codes";
import {
  isDeferredStage,
  isExemptStage,
  isPostSaleStage,
  type CustomerStateRules,
} from "./rules";
import { normalizeSalesStage, type NormalizedStage } from "./stages";
import { getStateCalendarDayDifference, parseStateInstant } from "./time";
import type { CustomerStateFacts } from "./types";

export type StateScope = {
  stage: NormalizedStage;
  isStageUnknown: boolean;
  isPostSale: boolean;
  isClosedLost: boolean;
  isUnowned: boolean;
  isDeferred: boolean;
  /**
   * Resolved cause for steps 1–4 of the shared precedence, in exactly the
   * specified order: post_sale, closed_lost, stage_unknown, unowned.
   * `null` when none applies.
   */
  exemptionCause: StateExemptionCause | null;
  /** R2 §C — canonical parse of `lastValidFollowUpAt`. */
  parsedLastValidFollowUpAt: Date | null;
  /** R2 §C — non-null AND parseable. Malformed behaves exactly like absent. */
  hasValidInteractionTimestamp: boolean;
  /** SLA and Attention only (RULE C). Null when absent or malformed. */
  parsedNextFollowUpAt: Date | null;
  /** RULE R-B — business-calendar days; null without a valid interaction. */
  daysSinceValidInteraction: number | null;
};

export function resolveStateScope(
  facts: CustomerStateFacts,
  rules: CustomerStateRules,
  now: Date,
): StateScope {
  const stage = normalizeSalesStage(facts.salesStage);
  const isStageUnknown = stage.kind === "unknown";
  const canonical = stage.kind === "canonical" ? stage.stage : null;

  const isPostSale = canonical !== null && isPostSaleStage(rules, canonical);
  const isClosedLost = canonical !== null && isExemptStage(rules, canonical);
  const isDeferred = canonical !== null && isDeferredStage(rules, canonical);
  const isUnowned = facts.ownerId === null || facts.status === "public_pool";

  const exemptionCause: StateExemptionCause | null = isPostSale
    ? "post_sale"
    : isClosedLost
      ? "closed_lost"
      : isStageUnknown
        ? "stage_unknown"
        : isUnowned
          ? "unowned"
          : null;

  const parsedLastValidFollowUpAt = parseStateInstant(
    facts.lastValidFollowUpAt,
  );

  return {
    stage,
    isStageUnknown,
    isPostSale,
    isClosedLost,
    isUnowned,
    isDeferred,
    exemptionCause,
    parsedLastValidFollowUpAt,
    hasValidInteractionTimestamp: parsedLastValidFollowUpAt !== null,
    parsedNextFollowUpAt: parseStateInstant(facts.nextFollowUpAt),
    daysSinceValidInteraction:
      parsedLastValidFollowUpAt === null
        ? null
        : getStateCalendarDayDifference(
            parsedLastValidFollowUpAt,
            now,
            facts.businessTimezone,
          ),
  };
}
