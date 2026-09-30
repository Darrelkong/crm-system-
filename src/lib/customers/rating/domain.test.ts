import assert from "node:assert/strict";
import { it } from "node:test";
import { FOLLOW_UP_OUTCOMES, isValidFollowUpOutcome } from "../../constants/follow-up-outcomes";
import {
  CUSTOMER_RATINGS, FOLLOW_UP_RATING_POLICY, RATING_REQUIRED_OUTCOMES, RATING_PRESERVE_OUTCOMES,
  isCustomerRating, isCustomerRatingValue, customerRatingRank, planFollowUpRating, planManualRatingCorrection,
} from "./domain";

it("only S/A/B/D and explicit null are valid; no implicit AI/outcome mapping", () => {
  for (const r of CUSTOMER_RATINGS) assert.equal(isCustomerRating(r), true);
  assert.equal(isCustomerRatingValue(null), true);
  assert.equal(isCustomerRating(null), false);
  for (const v of ["C", "", "unrated", "high", "interested", "s", 0, undefined, {}]) {
    assert.equal(isCustomerRatingValue(v), false);
  }
  assert.deepEqual([...CUSTOMER_RATINGS, null].map(customerRatingRank), [0, 1, 2, 3, 4]);
});
it("all current outcomes are exhaustively classified, with exactly eight required and three preserved", () => {
  assert.deepEqual(Object.keys(FOLLOW_UP_RATING_POLICY).sort(), [...FOLLOW_UP_OUTCOMES].sort());
  assert.deepEqual([...RATING_REQUIRED_OUTCOMES].sort(), ["contact_made", "replied", "interested", "considering", "not_interested", "awaiting_documents", "awaiting_quotation", "awaiting_internal_confirmation"].sort());
  assert.deepEqual([...RATING_PRESERVE_OUTCOMES].sort(), ["no_contact", "no_reply", "lost_contact"].sort());
  for (const outcome of RATING_REQUIRED_OUTCOMES) {
    assert.throws(() => planFollowUpRating({ rating: "A", revision: 3 }, outcome), /HUMAN_RATING_REQUIRED/);
    assert.throws(() => planFollowUpRating({ rating: "A", revision: 3 }, outcome, null), /HUMAN_RATING_REQUIRED/);
  }
});
it("same-rating active confirmation records history and increments revision", () => {
  assert.deepEqual(planFollowUpRating({ rating: "A", revision: 7 }, "replied", "A"), {
    ratingBefore: "A", ratingAfter: "A", revisionBefore: 7, revisionAfter: 8,
    action: "follow_up_confirmed", reason: null, createsHistory: true,
  });
});
it("no-contact outcomes preserve rated/unrated state with no history or revision, even with stale selector data", () => {
  for (const outcome of RATING_PRESERVE_OUTCOMES) for (const rating of [...CUSTOMER_RATINGS, null]) {
    const plan = planFollowUpRating({ rating, revision: 2 }, outcome, "S");
    assert.deepEqual(plan, { ratingBefore: rating, ratingAfter: rating, revisionBefore: 2,
      revisionAfter: 2, action: null, reason: null, createsHistory: false });
  }
});
it("rating policy does not change reclaim-valid semantics", () => {
  assert.equal(FOLLOW_UP_RATING_POLICY.not_interested, "required");
  assert.equal(isValidFollowUpOutcome("not_interested"), false);
  assert.deepEqual(FOLLOW_UP_OUTCOMES.filter(isValidFollowUpOutcome), ["contact_made", "replied", "interested", "considering", "awaiting_documents", "awaiting_quotation", "awaiting_internal_confirmation"]);
});
it("backdated follow-up decisions follow submission revision, never followUpTime", () => {
  const submissions = [
    { followUpTime: "2026-09-27", rating: "B" as const },
    { followUpTime: "2026-01-01", rating: "S" as const },
  ];
  let current = { rating: null as "B" | "S" | null, revision: 0 };
  for (const submission of submissions) {
    const decision = planFollowUpRating(current, "contact_made", submission.rating);
    current = { rating: decision.ratingAfter as "B" | "S", revision: decision.revisionAfter };
  }
  assert.deepEqual(current, { rating: "S", revision: 2 });
});
it("manual correction/clear requires human reason, blocks Public Pool and contains no follow-up/reclaim/task effects", () => {
  for (const before of [...CUSTOMER_RATINGS, null]) for (const after of CUSTOMER_RATINGS) {
    const p = planManualRatingCorrection({ rating: before, revision: 2 }, after, "Human correction", "active");
    assert.equal(p.action, "manual_correction"); assert.equal(p.revisionAfter, 3);
    assert.deepEqual(Object.keys(p).sort(), ["ratingBefore", "ratingAfter", "revisionBefore", "revisionAfter", "action", "reason", "createsHistory"].sort());
  }
  assert.equal(planManualRatingCorrection({ rating: "S", revision: 1 }, null, "Clear after review", "active").action, "manual_clear");
  assert.throws(() => planManualRatingCorrection({ rating: "A", revision: 0 }, "S", "human reason", "public_pool"), /PUBLIC_POOL/);
  assert.throws(() => planManualRatingCorrection({ rating: "A", revision: 0 }, "S", "  four  ", "active"), /REASON_REQUIRED/);
  assert.throws(() => planManualRatingCorrection({ rating: null, revision: 0 }, null, "human reason", "active"), /ALREADY_UNRATED/);
});
it("invalid and exhausted revisions fail safely", () => {
  for (const revision of [-1, 0.5, NaN, Infinity]) assert.throws(() => planFollowUpRating({ rating: null, revision }, "replied", "B"), /INVALID_CURRENT/);
  assert.throws(() => planFollowUpRating({ rating: null, revision: Number.MAX_SAFE_INTEGER }, "replied", "B"), /EXHAUSTED/);
});
