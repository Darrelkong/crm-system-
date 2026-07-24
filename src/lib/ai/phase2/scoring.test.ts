import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPhase2ContextFromPlain,
  scoreOpportunity,
} from "@/lib/ai/phase2";

const NOW = new Date("2026-07-20T04:00:00.000Z");

function richContext() {
  return buildPhase2ContextFromPlain({
    customerId: "c1",
    salesStage: "qualified",
    requestedProjectName: "香港身份规划",
    customerIntent: "了解高才通申请条件",
    initialNote: "客户想了解香港高才通，预算和材料还在准备中",
    source: "referral",
    createdAt: "2026-07-01T00:00:00.000Z",
    lastFollowUpAt: "2026-07-18T00:00:00.000Z",
    lastValidFollowUpAt: "2026-07-18T00:00:00.000Z",
    nextFollowUpAt: "2026-07-25T00:00:00.000Z",
    contactAvailability: { hasWeChat: true, hasPhone: true },
    heat: {
      heatLevel: "medium",
      daysWithoutValidFollowUp: 2,
      nextFollowUpOverdue: false,
      reclaimWarningLikely: false,
    },
    recentFollowUps: [
      {
        id: "f1",
        followUpTime: "2026-07-18T00:00:00.000Z",
        channel: "wechat",
        outcome: "replied",
        summary: "客户回复询问材料清单",
        nextAction: "发送材料清单并确认时间",
        nextFollowUpAt: "2026-07-25T00:00:00.000Z",
        customerIntent: "继续了解",
        isValidFollowUp: true,
      },
      {
        id: "f2",
        followUpTime: "2026-07-10T00:00:00.000Z",
        channel: "phone",
        outcome: "contact_made",
        summary: "电话沟通确认需求",
        nextAction: "安排二次说明",
        isValidFollowUp: true,
      },
    ],
  });
}

describe("phase2 local scoring", () => {
  it("scores full structured data deterministically", () => {
    const a = scoreOpportunity({ context: richContext(), now: NOW });
    const b = scoreOpportunity({ context: richContext(), now: NOW });
    assert.equal(a.status, "available");
    assert.ok(typeof a.score === "number");
    assert.equal(a.score, b.score);
    assert.equal(a.trend, "unavailable");
    assert.ok(a.score! >= 0 && a.score! <= 100);
  });

  it("does not penalize missing budget or timezone", () => {
    const scored = scoreOpportunity({ context: richContext(), now: NOW });
    const explanations = scored.breakdown.map((row) => row.explanation).join(" ");
    assert.equal(explanations.includes("budget"), false);
    assert.equal(explanations.includes("timezone"), false);
  });

  it("excludes DOCUMENT_READINESS when no document signal", () => {
    const scored = scoreOpportunity({ context: richContext(), now: NOW });
    const doc = scored.breakdown.find((row) => row.code === "DOCUMENT_READINESS");
    assert.equal(doc?.status, "not_applicable");
    assert.equal(doc?.score, null);
  });

  it("returns insufficient_data when applicable weight is below 60", () => {
    const thin = buildPhase2ContextFromPlain({
      customerId: "c2",
      salesStage: "new_lead",
      // almost no signals
      recentFollowUps: [],
    });
    const scored = scoreOpportunity({ context: thin, now: NOW });
    assert.equal(scored.status, "insufficient_data");
    assert.equal(scored.score, null);
    assert.equal(scored.confidence, "low");
  });

  it("marks CUSTOMER_INITIATIVE insufficient without initiative evidence", () => {
    const ctx = buildPhase2ContextFromPlain({
      customerId: "c3",
      salesStage: "contacted",
      requestedProjectName: "美国移民咨询",
      initialNote: "朋友介绍想了解美国项目",
      lastFollowUpAt: "2026-07-19T00:00:00.000Z",
      nextFollowUpAt: "2026-07-28T00:00:00.000Z",
      recentFollowUps: [
        {
          id: "f9",
          followUpTime: "2026-07-19T00:00:00.000Z",
          outcome: "no_contact",
          summary: "未接通",
          nextAction: "改日再打",
          isValidFollowUp: false,
        },
      ],
    });
    const scored = scoreOpportunity({ context: ctx, now: NOW });
    const initiative = scored.breakdown.find(
      (row) => row.code === "CUSTOMER_INITIATIVE",
    );
    assert.equal(initiative?.status, "insufficient_data");
  });

  it("includes next_action in NEXT_STEP_CLARITY", () => {
    const scored = scoreOpportunity({ context: richContext(), now: NOW });
    const next = scored.breakdown.find((row) => row.code === "NEXT_STEP_CLARITY");
    assert.equal(next?.status, "scored");
    assert.ok(next!.basis.some((b) => b.field === "next_action"));
  });

  it("does not mutate context", () => {
    const ctx = richContext();
    const before = JSON.stringify(ctx);
    scoreOpportunity({ context: ctx, now: NOW });
    assert.equal(JSON.stringify(ctx), before);
  });
});
