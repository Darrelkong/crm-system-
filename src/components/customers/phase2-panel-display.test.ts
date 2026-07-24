import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSuggestedMessageResetKey,
  hasRenderablePhase2,
  resolveOpportunityScoreDisplay,
  shouldDeemphasizeIntentScore,
  shouldShowAdvancedUnavailableNotice,
} from "@/components/customers/phase2-panel-display";
import type { Phase2Insight } from "@/lib/ai/phase2/types";
import { OPPORTUNITY_CATEGORY_CODES, PHASE2_VERSION } from "@/lib/ai/phase2/types";
import {
  isPhase2SafeSuggestedMessagePlaceholder,
  isSafeSuggestedMessageAvailable,
  PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER,
} from "@/lib/ai/customer-insights/safe-suggested-message";

function emptyBreakdown(): Phase2Insight["opportunity"]["breakdown"] {
  return OPPORTUNITY_CATEGORY_CODES.map((code) => ({
    code,
    labelKey: code,
    weight: 10,
    status: "insufficient_data" as const,
    score: null,
    weightedScore: null,
    confidence: "low" as const,
    basis: [],
    explanation: "n/a",
  }));
}

function phase2WithScore(
  score: number | null,
  status: "available" | "insufficient_data",
): Phase2Insight {
  return {
    version: PHASE2_VERSION,
    opportunity: {
      status,
      score,
      confidence: "medium",
      trend: "unavailable",
      breakdown: emptyBreakdown(),
      positiveFactors: [],
      negativeFactors: [],
      recommendedAction: null,
    },
    painPoints: [],
    churnRisk: {
      level: "insufficient_data",
      confidence: "low",
      customerBehaviorRisk: [],
      crmProcessRisk: [],
      evidence: [],
      summary: "insufficient",
    },
    followUpRecommendation: {
      date: null,
      timeWindow: null,
      channel: null,
      topic: null,
      confidence: "low",
      basis: [],
      insufficientDataReason: "not enough data",
    },
    missingInformation: [],
  };
}

describe("phase2 panel display helpers", () => {
  it("treats null/undefined phase2 as not renderable", () => {
    assert.equal(hasRenderablePhase2(null), false);
    assert.equal(hasRenderablePhase2(undefined), false);
  });

  it("treats valid phase2 as renderable even with score 0 and empty arrays", () => {
    const phase2 = phase2WithScore(0, "available");
    assert.equal(hasRenderablePhase2(phase2), true);
    assert.equal(phase2.painPoints.length, 0);
  });

  it("keeps insufficient opportunity visible as renderable phase2", () => {
    assert.equal(
      hasRenderablePhase2(phase2WithScore(null, "insufficient_data")),
      true,
    );
  });

  it("formats opportunity score including 0 and treats null as insufficient", () => {
    assert.deepEqual(
      resolveOpportunityScoreDisplay(phase2WithScore(0, "available").opportunity),
      { kind: "score", score: 0 },
    );
    assert.deepEqual(
      resolveOpportunityScoreDisplay(
        phase2WithScore(100, "available").opportunity,
      ),
      { kind: "score", score: 100 },
    );
    assert.deepEqual(
      resolveOpportunityScoreDisplay(
        phase2WithScore(null, "insufficient_data").opportunity,
      ),
      { kind: "insufficient" },
    );
    assert.deepEqual(resolveOpportunityScoreDisplay(null), {
      kind: "insufficient",
    });
  });

  it("de-emphasizes intentScore when opportunity score 0 or 100 is available", () => {
    assert.equal(
      shouldDeemphasizeIntentScore(phase2WithScore(0, "available"), 72),
      true,
    );
    assert.equal(
      shouldDeemphasizeIntentScore(phase2WithScore(100, "available"), 72),
      true,
    );
  });

  it("keeps intentScore when phase2 absent or opportunity insufficient", () => {
    assert.equal(shouldDeemphasizeIntentScore(null, 72), false);
    assert.equal(
      shouldDeemphasizeIntentScore(
        phase2WithScore(null, "insufficient_data"),
        72,
      ),
      false,
    );
  });

  it("shows advanced unavailable notice only after successful degraded refresh", () => {
    assert.equal(
      shouldShowAdvancedUnavailableNotice({
        refreshSucceeded: true,
        phase2Generated: false,
      }),
      true,
    );
    assert.equal(
      shouldShowAdvancedUnavailableNotice({
        refreshSucceeded: true,
        phase2Generated: true,
      }),
      false,
    );
    assert.equal(
      shouldShowAdvancedUnavailableNotice({
        refreshSucceeded: false,
        phase2Generated: false,
      }),
      false,
    );
    assert.equal(
      shouldShowAdvancedUnavailableNotice({
        refreshSucceeded: true,
        phase2Generated: undefined,
      }),
      false,
    );
  });

  it("builds stable draft reset keys from insight identity", () => {
    const a = buildSuggestedMessageResetKey({
      customerId: "c1",
      insightId: "i1",
      generatedAt: "t1",
      sourceMessage: "hello",
    });
    const same = buildSuggestedMessageResetKey({
      customerId: "c1",
      insightId: "i1",
      generatedAt: "t1",
      sourceMessage: "hello",
    });
    const changedGenerated = buildSuggestedMessageResetKey({
      customerId: "c1",
      insightId: "i1",
      generatedAt: "t2",
      sourceMessage: "hello",
    });
    assert.equal(a, same);
    assert.notEqual(a, changedGenerated);
  });
});

describe("safe suggested message availability", () => {
  it("uses exact placeholder match and rejects near-miss strings", () => {
    assert.equal(
      isPhase2SafeSuggestedMessagePlaceholder(
        PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER,
      ),
      true,
    );
    assert.equal(
      isPhase2SafeSuggestedMessagePlaceholder(
        `${PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER} `,
      ),
      false,
    );
    assert.equal(isSafeSuggestedMessageAvailable(""), false);
    assert.equal(isSafeSuggestedMessageAvailable("   "), false);
    assert.equal(isSafeSuggestedMessageAvailable(null), false);
    assert.equal(
      isSafeSuggestedMessageAvailable(PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER),
      false,
    );
    assert.equal(
      isSafeSuggestedMessageAvailable("您好，想确认一下资料准备情况。"),
      true,
    );
  });
});
