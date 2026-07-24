import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TOTAL_CATEGORY_WEIGHT,
  MINIMUM_APPLICABLE_WEIGHT,
  OPPORTUNITY_CATEGORY_WEIGHTS,
  buildPhase2ContextFromPlain,
  countIndependentEvidenceSources,
  finalizeOpportunityFromBreakdown,
  parseExplicitCalendarDate,
  buildFollowUpRecommendation,
  getFixedComplianceRules,
  resolvePrimaryScoreDisplay,
  safeParsePhase2Insight,
  PHASE2_VERSION,
  PHASE2_LIMITS,
  maskEvidenceExcerpt,
} from "@/lib/ai/phase2";
import type { OpportunityScoreBreakdown } from "@/lib/ai/phase2";

function scoredRow(
  code: OpportunityScoreBreakdown["code"],
  score: number,
  basis: OpportunityScoreBreakdown["basis"] = [],
): OpportunityScoreBreakdown {
  const weight = OPPORTUNITY_CATEGORY_WEIGHTS[code];
  return {
    code,
    labelKey: `phase2.opportunity.${code}`,
    weight,
    status: "scored",
    score,
    weightedScore: (score * weight) / 100,
    confidence: "medium",
    basis,
    explanation: "test",
  };
}

function naRow(
  code: OpportunityScoreBreakdown["code"],
): OpportunityScoreBreakdown {
  return {
    code,
    labelKey: `phase2.opportunity.${code}`,
    weight: OPPORTUNITY_CATEGORY_WEIGHTS[code],
    status: "not_applicable",
    score: null,
    weightedScore: null,
    confidence: "low",
    basis: [],
    explanation: "n/a",
  };
}

describe("phase2 precommit hardening", () => {
  it("keeps category weights totaling exactly 100", () => {
    assert.equal(TOTAL_CATEGORY_WEIGHT, 100);
    assert.equal(MINIMUM_APPLICABLE_WEIGHT, 60);
  });

  it("computes exact weighted averages and 59/60 thresholds", () => {
    const all100 = finalizeOpportunityFromBreakdown({
      breakdown: [
        scoredRow("NEED_CLARITY", 100),
        scoredRow("INTERACTION_ACTIVITY", 100),
        scoredRow("CUSTOMER_INITIATIVE", 100),
        scoredRow("TIMELINE_READINESS", 100),
        scoredRow("DOCUMENT_READINESS", 100),
        scoredRow("NEXT_STEP_CLARITY", 100),
        scoredRow("CONCERN_SEVERITY", 100),
        scoredRow("ENGAGEMENT_RISK", 100),
        scoredRow("RECORD_RELIABILITY", 100),
      ],
    });
    assert.equal(all100.status, "available");
    assert.equal(all100.score, 100);

    const all0 = finalizeOpportunityFromBreakdown({
      breakdown: [
        scoredRow("NEED_CLARITY", 0),
        scoredRow("INTERACTION_ACTIVITY", 0),
        scoredRow("CUSTOMER_INITIATIVE", 0),
        scoredRow("TIMELINE_READINESS", 0),
        scoredRow("DOCUMENT_READINESS", 0),
        scoredRow("NEXT_STEP_CLARITY", 0),
        scoredRow("CONCERN_SEVERITY", 0),
        scoredRow("ENGAGEMENT_RISK", 0),
        scoredRow("RECORD_RELIABILITY", 0),
      ],
    });
    assert.equal(all0.score, 0);

    // Weight 60 exactly: NEED(15)+INTERACTION(15)+INITIATIVE(15)+NEXT(15)=60
    const at60 = finalizeOpportunityFromBreakdown({
      breakdown: [
        scoredRow("NEED_CLARITY", 80),
        scoredRow("INTERACTION_ACTIVITY", 80),
        scoredRow("CUSTOMER_INITIATIVE", 80),
        naRow("TIMELINE_READINESS"),
        naRow("DOCUMENT_READINESS"),
        scoredRow("NEXT_STEP_CLARITY", 80),
        naRow("CONCERN_SEVERITY"),
        naRow("ENGAGEMENT_RISK"),
        naRow("RECORD_RELIABILITY"),
      ],
    });
    assert.equal(at60.status, "available");
    assert.equal(at60.score, 80);

    // Weight 55 < 60: NEED 15 + INTERACTION 15 + INITIATIVE 15 + ENGAGEMENT 5 + RECORD 5
    const below60 = finalizeOpportunityFromBreakdown({
      breakdown: [
        scoredRow("NEED_CLARITY", 100),
        scoredRow("INTERACTION_ACTIVITY", 100),
        scoredRow("CUSTOMER_INITIATIVE", 100),
        naRow("TIMELINE_READINESS"),
        naRow("DOCUMENT_READINESS"),
        naRow("NEXT_STEP_CLARITY"),
        naRow("CONCERN_SEVERITY"),
        scoredRow("ENGAGEMENT_RISK", 100),
        scoredRow("RECORD_RELIABILITY", 100),
      ],
    });
    assert.equal(below60.status, "insufficient_data");
    assert.equal(below60.score, null);
    assert.equal(below60.confidence, "low");
  });

  it("deduplicates evidence sources and ignores system rules for confidence count", () => {
    const count = countIndependentEvidenceSources([
      scoredRow("NEED_CLARITY", 50, [
        {
          sourceType: "follow_up",
          sourceId: "f1",
          occurredAt: null,
          excerpt: "a",
          field: null,
        },
        {
          sourceType: "follow_up",
          sourceId: "f1",
          occurredAt: null,
          excerpt: "b",
          field: null,
        },
        {
          sourceType: "system_rule",
          sourceId: "RULE_A",
          occurredAt: null,
          excerpt: "x",
          field: null,
        },
        {
          sourceType: "system_rule",
          sourceId: "RULE_B",
          occurredAt: null,
          excerpt: "y",
          field: null,
        },
        {
          sourceType: "customer_field",
          sourceId: null,
          occurredAt: null,
          excerpt: "stage",
          field: "sales_stage",
        },
      ]),
    ]);
    assert.equal(count, 2);
  });

  it("rejects invalid calendar dates and keeps timeWindow null", () => {
    assert.equal(parseExplicitCalendarDate("2026-02-30"), null);
    assert.equal(parseExplicitCalendarDate("2026-13-01"), null);
    assert.equal(parseExplicitCalendarDate("2026-07-20T10:00:00.000Z"), "2026-07-20");
    const rec = buildFollowUpRecommendation({
      context: buildPhase2ContextFromPlain({
        customerId: "c1",
        salesStage: "new_lead",
        nextFollowUpAt: "2026-02-30T00:00:00.000Z",
      }),
    });
    assert.equal(rec.date, null);
    assert.equal(rec.timeWindow, null);
  });

  it("limits follow-ups to 10 with deterministic newest-first ordering", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `f${String(i).padStart(2, "0")}`,
      followUpTime: `2026-07-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      summary: `row ${i}`,
      nextAction: "跟进",
      outcome: "contact_made",
    }));
    const original = rows.map((r) => ({ ...r }));
    const ctx = buildPhase2ContextFromPlain({
      customerId: "c1",
      salesStage: "qualified",
      recentFollowUps: rows,
    });
    assert.equal(ctx.recentFollowUps.length, 10);
    assert.equal(ctx.recentFollowUps[0]?.id, "f11");
    assert.equal(ctx.recentFollowUps[9]?.id, "f02");
    assert.deepEqual(rows, original);
  });

  it("keeps compliance rules immutable and treats score 0 as valid", () => {
    const rules = getFixedComplianceRules();
    assert.equal(rules.length, 14);
    assert.throws(() => {
      // @ts-expect-error readonly
      rules.push({ id: "X", text: "y" });
    });
    assert.deepEqual(
      resolvePrimaryScoreDisplay({
        intentScore: 40,
        phase2OpportunityScore: 0,
      }),
      {
        primaryScore: 0,
        primarySource: "opportunity",
        showLegacyIntentScore: false,
        trend: "unavailable",
      },
    );
    assert.equal(
      resolvePrimaryScoreDisplay({
        intentScore: 40,
        phase2OpportunityScore: null,
      }).primarySource,
      "intentScore",
    );
  });

  it("rejects invalid calendar date in Zod contract", () => {
    const parsed = safeParsePhase2Insight({
      version: PHASE2_VERSION,
      opportunity: {
        status: "available",
        score: 50,
        confidence: "low",
        trend: "unavailable",
        breakdown: [],
        positiveFactors: [],
        negativeFactors: [],
        recommendedAction: null,
      },
      painPoints: [],
      churnRisk: {
        level: "low",
        confidence: "low",
        customerBehaviorRisk: [],
        crmProcessRisk: [],
        evidence: [],
        summary: "ok",
      },
      followUpRecommendation: {
        date: "2026-02-30",
        timeWindow: null,
        channel: null,
        topic: null,
        confidence: "low",
        basis: [],
        insufficientDataReason: null,
      },
      missingInformation: [],
    });
    assert.equal(parsed.success, false);
  });

  it("masks long inputs within excerpt limit without hanging", () => {
    const big = `${"客户沟通 ".repeat(40)}电话 +86 138 0000 1234 ${"x".repeat(2000)}`;
    const start = Date.now();
    const masked = maskEvidenceExcerpt(big.slice(0, PHASE2_LIMITS.evidenceExcerptMaxChars * 4));
    assert.ok(Date.now() - start < 200);
    assert.match(masked, /\[phone\]/);
  });
});
