import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PHASE2_VERSION,
  safeParsePhase2ExtractedSignals,
  safeParsePhase2Insight,
} from "@/lib/ai/phase2";

function validInsight(overrides: Record<string, unknown> = {}) {
  return {
    version: PHASE2_VERSION,
    opportunity: {
      status: "available",
      score: 72,
      confidence: "medium",
      trend: "unavailable",
      breakdown: [
        {
          code: "NEED_CLARITY",
          labelKey: "phase2.opportunity.needClarity",
          weight: 15,
          status: "scored",
          score: 70,
          weightedScore: 10.5,
          confidence: "medium",
          basis: [],
          explanation: "Need clarity scored",
        },
      ],
      positiveFactors: [],
      negativeFactors: [],
      recommendedAction: "跟进确认客户目标",
    },
    painPoints: [],
    churnRisk: {
      level: "low",
      confidence: "low",
      customerBehaviorRisk: [],
      crmProcessRisk: [],
      evidence: [],
      summary: "No major risk",
    },
    followUpRecommendation: {
      date: "2026-07-30",
      timeWindow: null,
      channel: "wechat",
      topic: "确认资料准备",
      confidence: "medium",
      basis: [],
      insufficientDataReason: null,
    },
    missingInformation: [],
    ...overrides,
  };
}

describe("phase2 contract schema", () => {
  it("accepts a valid full Phase 2 insight", () => {
    const parsed = safeParsePhase2Insight(validInsight());
    assert.equal(parsed.success, true);
  });

  it("accepts insufficient_data with score null", () => {
    const parsed = safeParsePhase2Insight(
      validInsight({
        opportunity: {
          status: "insufficient_data",
          score: null,
          confidence: "low",
          trend: "unavailable",
          breakdown: [],
          positiveFactors: [],
          negativeFactors: [],
          recommendedAction: null,
        },
      }),
    );
    assert.equal(parsed.success, true);
  });

  it("rejects score when status is insufficient_data", () => {
    const parsed = safeParsePhase2Insight(
      validInsight({
        opportunity: {
          status: "insufficient_data",
          score: 0,
          confidence: "low",
          trend: "unavailable",
          breakdown: [],
          positiveFactors: [],
          negativeFactors: [],
          recommendedAction: null,
        },
      }),
    );
    assert.equal(parsed.success, false);
  });

  it("rejects invalid version and unknown fields", () => {
    assert.equal(
      safeParsePhase2Insight(validInsight({ version: "phase-1" })).success,
      false,
    );
    assert.equal(
      safeParsePhase2Insight(validInsight({ extra: true })).success,
      false,
    );
  });

  it("rejects invalid category, non-null timeWindow, and HTML", () => {
    const badCategory = validInsight();
    (badCategory.opportunity as { breakdown: Array<{ code: string }> }).breakdown[0]!.code =
      "WEALTH";
    assert.equal(safeParsePhase2Insight(badCategory).success, false);

    assert.equal(
      safeParsePhase2Insight(
        validInsight({
          followUpRecommendation: {
            date: null,
            timeWindow: "morning",
            channel: null,
            topic: null,
            confidence: "low",
            basis: [],
            insufficientDataReason: "x",
          },
        }),
      ).success,
      false,
    );

    assert.equal(
      safeParsePhase2Insight(
        validInsight({
          churnRisk: {
            level: "low",
            confidence: "low",
            customerBehaviorRisk: [],
            crmProcessRisk: [],
            evidence: [],
            summary: "<script>alert(1)</script>",
          },
        }),
      ).success,
      false,
    );
  });

  it("rejects oversized excerpt and too many pain points", () => {
    const insight = validInsight({
      painPoints: Array.from({ length: 6 }, (_, i) => ({
        code: "COST_CONCERN",
        labelKey: "x",
        severity: "low",
        confidence: "low",
        summary: `concern ${i}`,
        evidence: [
          {
            sourceType: "initial_note",
            sourceId: "initial_note",
            occurredAt: null,
            excerpt: "费用相关",
            field: null,
          },
        ],
        recommendedResponse: null,
      })),
    });
    assert.equal(safeParsePhase2Insight(insight).success, false);

    const longExcerpt = validInsight({
      painPoints: [
        {
          code: "COST_CONCERN",
          labelKey: "x",
          severity: "low",
          confidence: "low",
          summary: "费用",
          evidence: [
            {
              sourceType: "initial_note",
              sourceId: "initial_note",
              occurredAt: null,
              excerpt: "a".repeat(161),
              field: null,
            },
          ],
          recommendedResponse: null,
        },
      ],
    });
    assert.equal(safeParsePhase2Insight(longExcerpt).success, false);
  });

  it("rejects score outside 0-100 and markdown fences", () => {
    assert.equal(
      safeParsePhase2Insight(
        validInsight({
          opportunity: {
            status: "available",
            score: 101,
            confidence: "low",
            trend: "unavailable",
            breakdown: [],
            positiveFactors: [],
            negativeFactors: [],
            recommendedAction: null,
          },
        }),
      ).success,
      false,
    );
    assert.equal(
      safeParsePhase2Insight(
        validInsight({
          opportunity: {
            status: "available",
            score: 50,
            confidence: "low",
            trend: "unavailable",
            breakdown: [],
            positiveFactors: [],
            negativeFactors: [],
            recommendedAction: "```bad```",
          },
        }),
      ).success,
      false,
    );
  });

  it("accepts extracted signals without final scores", () => {
    const parsed = safeParsePhase2ExtractedSignals({
      needClarity: {
        level: "medium",
        confidence: "medium",
        summary: "需求较明确",
        evidence: [
          {
            sourceType: "initial_note",
            sourceId: "initial_note",
            occurredAt: null,
            excerpt: "想了解香港身份",
            field: null,
          },
        ],
      },
      customerInitiative: null,
      timelineReadiness: null,
      documentReadiness: null,
      concerns: [],
      customerBehaviorRisk: [],
      recommendedTopic: null,
    });
    assert.equal(parsed.success, true);
  });
});
