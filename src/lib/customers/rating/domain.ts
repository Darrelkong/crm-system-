import type { FollowUpOutcome } from "../../constants/follow-up-outcomes";

/** Human decisions only. Never derive these values from AI, stage or outcome. */
export const CUSTOMER_RATINGS = ["S", "A", "B", "D"] as const;
export type CustomerRating = (typeof CUSTOMER_RATINGS)[number];
export type CustomerRatingValue = CustomerRating | null;
export const CUSTOMER_RATING_ACTIONS = [
  "follow_up_confirmed", "manual_correction", "manual_clear",
] as const;
export type CustomerRatingAction = (typeof CUSTOMER_RATING_ACTIONS)[number];
export const MANUAL_RATING_REASON_MIN_LENGTH = 5;

export function isCustomerRating(value: unknown): value is CustomerRating {
  return typeof value === "string" && CUSTOMER_RATINGS.some((rating) => rating === value);
}
export function isCustomerRatingValue(value: unknown): value is CustomerRatingValue {
  return value === null || isCustomerRating(value);
}
export function customerRatingRank(value: CustomerRatingValue): number {
  return value === null ? 4 : CUSTOMER_RATINGS.indexOf(value);
}

// Record exhaustiveness makes a newly added follow-up outcome a compile error.
export const FOLLOW_UP_RATING_POLICY = {
  contact_made: "required",
  replied: "required",
  interested: "required",
  considering: "required",
  not_interested: "required",
  awaiting_documents: "required",
  awaiting_quotation: "required",
  awaiting_internal_confirmation: "required",
  no_contact: "preserve",
  no_reply: "preserve",
  lost_contact: "preserve",
} as const satisfies Record<FollowUpOutcome, "required" | "preserve">;
export const RATING_REQUIRED_OUTCOMES = (Object.keys(FOLLOW_UP_RATING_POLICY) as FollowUpOutcome[])
  .filter((outcome) => FOLLOW_UP_RATING_POLICY[outcome] === "required");
export const RATING_PRESERVE_OUTCOMES = (Object.keys(FOLLOW_UP_RATING_POLICY) as FollowUpOutcome[])
  .filter((outcome) => FOLLOW_UP_RATING_POLICY[outcome] === "preserve");

export type RatingDecision = {
  ratingBefore: CustomerRatingValue;
  ratingAfter: CustomerRatingValue;
  revisionBefore: number;
  revisionAfter: number;
  action: CustomerRatingAction | null;
  reason: string | null;
  createsHistory: boolean;
};
type CurrentRating = { rating: CustomerRatingValue; revision: number };
function assertCurrent(current: CurrentRating): void {
  if (!isCustomerRatingValue(current.rating) || !Number.isSafeInteger(current.revision) || current.revision < 0) {
    throw new Error("INVALID_CURRENT_RATING");
  }
}
function humanDecision(current: CurrentRating, rating: CustomerRatingValue,
  action: CustomerRatingAction, reason: string | null): RatingDecision {
  if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error("RATING_REVISION_EXHAUSTED");
  return { ratingBefore: current.rating, ratingAfter: rating,
    revisionBefore: current.revision, revisionAfter: current.revision + 1,
    action, reason, createsHistory: true };
}
/** Pure contract, not persistence or authorization. No followUpTime: decisions follow submission revision. */
export function planFollowUpRating(current: CurrentRating, outcome: FollowUpOutcome,
  selectedRating?: unknown): RatingDecision {
  assertCurrent(current);
  const policy = FOLLOW_UP_RATING_POLICY[outcome];
  if (policy === "preserve") {
    // Ignore any stale selector payload: preservation is not a human decision.
    return { ratingBefore: current.rating, ratingAfter: current.rating,
      revisionBefore: current.revision, revisionAfter: current.revision,
      action: null, reason: null, createsHistory: false };
  }
  if (policy !== "required") throw new Error("UNKNOWN_FOLLOW_UP_OUTCOME");
  if (!isCustomerRating(selectedRating)) throw new Error("HUMAN_RATING_REQUIRED");
  return humanDecision(current, selectedRating, "follow_up_confirmed", null);
}
/** Pure future correction contract; caller must enforce customer/follow-up authorization separately. */
export function planManualRatingCorrection(current: CurrentRating, rating: unknown,
  reason: string, customerStatus: string): RatingDecision {
  assertCurrent(current);
  if (customerStatus === "public_pool") throw new Error("PUBLIC_POOL_RATING_FORBIDDEN");
  if (!isCustomerRatingValue(rating)) throw new Error("INVALID_CUSTOMER_RATING");
  const trimmed = reason.trim();
  if (Array.from(trimmed).length < MANUAL_RATING_REASON_MIN_LENGTH) throw new Error("RATING_REASON_REQUIRED");
  if (rating === null && current.rating === null) throw new Error("RATING_ALREADY_UNRATED");
  return humanDecision(current, rating, rating === null ? "manual_clear" : "manual_correction", trimmed);
}
