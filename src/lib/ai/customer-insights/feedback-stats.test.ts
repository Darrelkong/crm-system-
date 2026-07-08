import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateReasonTagRankings,
  buildSummaryFromRatings,
} from "@/lib/ai/customer-insights/feedback-stats";

describe("buildSummaryFromRatings", () => {
  it("returns empty summary when no ratings", () => {
    const summary = buildSummaryFromRatings([]);
    assert.equal(summary.totalCount, 0);
    assert.equal(summary.averageRating, null);
    assert.equal(summary.helpfulCount, 0);
    assert.equal(summary.neutralCount, 0);
    assert.equal(summary.notHelpfulCount, 0);
    assert.deepEqual(summary.ratingDistribution, {
      "1": 0,
      "2": 0,
      "3": 0,
      "4": 0,
      "5": 0,
    });
  });

  it("buckets ratings into helpful, neutral, and notHelpful", () => {
    const summary = buildSummaryFromRatings([5, 4, 3, 2, 1]);
    assert.equal(summary.totalCount, 5);
    assert.equal(summary.averageRating, 3);
    assert.equal(summary.helpfulCount, 2);
    assert.equal(summary.neutralCount, 1);
    assert.equal(summary.notHelpfulCount, 2);
    assert.deepEqual(summary.ratingDistribution, {
      "1": 1,
      "2": 1,
      "3": 1,
      "4": 1,
      "5": 1,
    });
  });
});

describe("aggregateReasonTagRankings", () => {
  it("aggregates whitelist reason tags and sorts by count desc", () => {
    const rankings = aggregateReasonTagRankings([
      '["too_long","other"]',
      '["too_long","inaccurate_intent"]',
      '["invalid_tag","too_short"]',
    ]);

    assert.deepEqual(rankings, [
      { tag: "too_long", count: 2 },
      { tag: "inaccurate_intent", count: 1 },
      { tag: "other", count: 1 },
      { tag: "too_short", count: 1 },
    ]);
  });

  it("returns empty array when no valid tags", () => {
    assert.deepEqual(aggregateReasonTagRankings(["[]", "not-json"]), []);
  });
});
