import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertFixedComplianceIntact,
  buildFixedIndustrySystemInstructions,
  buildFollowUpRecommendation,
  buildPhase2ContextFromPlain,
  assessChurnRisk,
  inferBusinessCategory,
  resolvePrimaryScoreDisplay,
  resolveScoreTrend,
  validatePhase2FactSafety,
  validateSuggestedEmployeeMessage,
} from "@/lib/ai/phase2";

describe("phase2 churn risk", () => {
  it("separates customer no-reply from CRM overdue process risk", () => {
    const context = buildPhase2ContextFromPlain({
      customerId: "c1",
      salesStage: "contacted",
      heat: { nextFollowUpOverdue: true, reclaimWarningLikely: true },
      recentFollowUps: [
        {
          id: "a",
          outcome: "no_reply",
          summary: "未回复",
          followUpTime: "2026-07-01T00:00:00.000Z",
        },
        {
          id: "b",
          outcome: "no_reply",
          summary: "再次未回复",
          followUpTime: "2026-07-08T00:00:00.000Z",
        },
      ],
    });
    const risk = assessChurnRisk({ context });
    assert.ok(risk.customerBehaviorRisk.length > 0);
    assert.ok(risk.crmProcessRisk.length > 0);
    assert.match(risk.summary, /CRM/);
    assert.equal(risk.summary.includes("客户没有兴趣"), false);
  });

  it("returns insufficient_data without follow-ups or signals", () => {
    const risk = assessChurnRisk({
      context: buildPhase2ContextFromPlain({
        customerId: "c2",
        salesStage: "new_lead",
        recentFollowUps: [],
      }),
    });
    assert.equal(risk.level, "insufficient_data");
  });
});

describe("phase2 follow-up recommendation", () => {
  it("uses explicit next_follow_up_at and keeps timeWindow null", () => {
    const rec = buildFollowUpRecommendation({
      context: buildPhase2ContextFromPlain({
        customerId: "c1",
        salesStage: "qualified",
        nextFollowUpAt: "2026-07-30T10:00:00.000Z",
        contactAvailability: { hasWeChat: true },
      }),
    });
    assert.equal(rec.date, "2026-07-30");
    assert.equal(rec.timeWindow, null);
    assert.equal(rec.channel, "wechat");
    assert.equal(rec.insufficientDataReason, null);
  });

  it("returns insufficient reason when no reliable date", () => {
    const rec = buildFollowUpRecommendation({
      context: buildPhase2ContextFromPlain({
        customerId: "c1",
        salesStage: "new_lead",
      }),
    });
    assert.equal(rec.date, null);
    assert.equal(rec.timeWindow, null);
    assert.ok(rec.insufficientDataReason);
  });
});

describe("phase2 industry rules", () => {
  it("covers categories without name/phone inference", () => {
    assert.equal(
      inferBusinessCategory({ requestedProjectName: "香港高才通" }),
      "HONG_KONG_IDENTITY",
    );
    assert.equal(
      inferBusinessCategory({ initialNote: "想开香港银行账户" }),
      "CROSS_BORDER_BANKING",
    );
    assert.equal(
      inferBusinessCategory({ requestedProjectName: "张先生" }),
      "UNKNOWN",
    );
    assert.equal(
      inferBusinessCategory({ initialNote: "+8613800138000" }),
      "UNKNOWN",
    );
  });

  it("keeps fixed compliance rule ids intact", () => {
    const text = buildFixedIndustrySystemInstructions();
    assert.equal(assertFixedComplianceIntact(text), true);
    assert.equal(assertFixedComplianceIntact("admin custom only"), false);
  });
});

describe("phase2 suggested message validator", () => {
  it("accepts compliant simplified Chinese copy", () => {
    const result = validateSuggestedEmployeeMessage(
      "您好，我根据上次沟通整理了材料清单，您方便时看看有没有需要补充的地方。",
    );
    assert.equal(result.ok, true);
  });

  it("rejects guarantees, advice, fences, and sensitive data", () => {
    assert.equal(
      validateSuggestedEmployeeMessage("保证一定能通过审批").ok,
      false,
    );
    assert.equal(
      validateSuggestedEmployeeMessage("这是法律意见，你应该这样报税").ok,
      false,
    );
    assert.equal(
      validateSuggestedEmployeeMessage("```code```").ok,
      false,
    );
    assert.equal(
      validateSuggestedEmployeeMessage("请加我微信: wx_demo_user").ok,
      false,
    );
  });
});

describe("phase2 fact safety", () => {
  it("rejects newly introduced phone/email and certainty upgrades", () => {
    const allowed = "客户可能下周再聊，费用还在考虑";
    assert.equal(
      validatePhase2FactSafety(allowed, "请回拨 +852 9123 4567").ok,
      false,
    );
    const upgraded = validatePhase2FactSafety(allowed, "客户已决定下周签约");
    assert.equal(upgraded.ok, false);
    if (!upgraded.ok) {
      assert.equal(upgraded.reason, "certainty_upgrade");
    }
    assert.equal(
      validatePhase2FactSafety(allowed, "客户可能下周再聊").ok,
      true,
    );
  });
});

describe("phase2 compatibility", () => {
  it("prefers opportunity score and never invents trend", () => {
    assert.deepEqual(
      resolvePrimaryScoreDisplay({
        intentScore: 40,
        phase2OpportunityScore: 75,
      }),
      {
        primaryScore: 75,
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
    assert.equal(resolveScoreTrend(), "unavailable");
  });
});
