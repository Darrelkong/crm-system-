import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBasicCustomerAnalysis } from "@/lib/ai/basic-analysis/rules";
import type { BasicAnalysisInput } from "@/lib/ai/basic-analysis/types";
import { BASIC_ANALYSIS_SOURCE } from "@/lib/ai/basic-analysis/types";
import {
  assertBasicAnalysisResponseSafe,
  basicAnalysisContainsForbiddenKeys,
} from "@/lib/ai/basic-analysis/response-safety";
import { isBasicAnalysisReclaimEligible } from "@/lib/ai/basic-analysis/input";
import type { Customer } from "../../../../drizzle/schema/customers";

function baseInput(
  overrides: Partial<BasicAnalysisInput> = {},
): BasicAnalysisInput {
  return {
    nowIso: "2026-07-20T04:00:00.000Z", // 12:00 HKT
    customerName: "Ada",
    phone: "+85211112222",
    wechatId: null,
    requestedProjectName: "Office fit-out",
    salesStage: "contacted",
    lastFollowUpAt: "2026-07-20T04:00:00.000Z",
    lastValidFollowUpAt: "2026-07-20T04:00:00.000Z",
    nextFollowUpAt: "2026-07-25T04:00:00.000Z",
    hasLatestNextAction: true,
    hasAnyFollowUp: true,
    reclaimEligible: true,
    automaticReclaimDays: 30,
    reclaimWarningThresholdDays: 20,
    daysWithoutValidFollowUp: 0,
    ...overrides,
  };
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "c1",
    customerCode: "EF-1",
    customerName: "Ada",
    customerType: "individual",
    phoneCountryCode: "+852",
    phone: "11112222",
    wechatId: null,
    email: null,
    source: "web",
    sourceRemark: null,
    requestedProjectName: "x",
    notes: null,
    salesStage: "contacted",
    status: "active",
    ownerId: "staff-1",
    releaserUserId: null,
    isPinned: 0,
    pinnedAt: null,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    nextFollowUpAt: null,
    createdBy: "staff-1",
    updatedBy: "staff-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    ...overrides,
  } as Customer;
}

describe("buildBasicCustomerAnalysis", () => {
  it("returns normal status for a complete customer with no urgent issues", () => {
    const result = buildBasicCustomerAnalysis(baseInput());
    assert.equal(result.source, BASIC_ANALYSIS_SOURCE);
    assert.equal(result.summaryStatus, "normal");
    assert.equal(result.findings.length, 0);
    assert.ok(result.positiveSignals.length > 0);
    assert.equal(result.nextRecommendedAction, null);
    assert.deepEqual(basicAnalysisContainsForbiddenKeys(result), []);
  });

  it("does not invent a 7-day follow-up risk threshold", () => {
    const source = buildBasicCustomerAnalysis.toString();
    assert.equal(/days\s*>=\s*7|>=\s*7/.test(source), false);
    const mid = buildBasicCustomerAnalysis(
      baseInput({
        lastFollowUpAt: "2026-07-12T04:00:00.000Z",
        daysWithoutValidFollowUp: 8,
        reclaimWarningThresholdDays: 20,
      }),
    );
    const daysSince = mid.findings.find((f) => f.code === "FOLLOW_UP_DAYS_SINCE");
    assert.ok(daysSince);
    assert.equal(daysSince?.severity, "info");
    assert.equal(mid.summaryStatus, "normal");
  });

  it("flags never followed-up customers", () => {
    const result = buildBasicCustomerAnalysis(
      baseInput({
        hasAnyFollowUp: false,
        lastFollowUpAt: null,
        lastValidFollowUpAt: null,
        nextFollowUpAt: null,
        hasLatestNextAction: false,
        reclaimEligible: false,
        daysWithoutValidFollowUp: 0,
      }),
    );
    assert.ok(result.findings.some((f) => f.code === "FOLLOW_UP_NEVER"));
    assert.equal(result.findings[0]?.code, "FOLLOW_UP_NEVER");
    assert.equal(result.nextRecommendedAction?.type, "ADD_FOLLOW_UP");
  });

  it("prioritizes reclamation over never-follow-up when both apply", () => {
    const result = buildBasicCustomerAnalysis(
      baseInput({
        hasAnyFollowUp: false,
        lastFollowUpAt: null,
        lastValidFollowUpAt: null,
        nextFollowUpAt: null,
        hasLatestNextAction: false,
        reclaimEligible: true,
        automaticReclaimDays: 30,
        reclaimWarningThresholdDays: 20,
        daysWithoutValidFollowUp: 22,
      }),
    );
    assert.equal(result.findings[0]?.code, "RECLAMATION_APPROACHING");
    assert.ok(result.findings.some((f) => f.code === "FOLLOW_UP_NEVER"));
    assert.equal(result.nextRecommendedAction?.type, "REVIEW_RECLAMATION");
  });

  it("emits objective days-since and escalates only at reclaim warning threshold", () => {
    const below = buildBasicCustomerAnalysis(
      baseInput({
        lastFollowUpAt: "2026-07-01T04:00:00.000Z",
        lastValidFollowUpAt: "2026-07-01T04:00:00.000Z",
        daysWithoutValidFollowUp: 19,
        reclaimWarningThresholdDays: 20,
      }),
    );
    assert.equal(
      below.findings.find((f) => f.code === "FOLLOW_UP_DAYS_SINCE")?.severity,
      "info",
    );

    const at = buildBasicCustomerAnalysis(
      baseInput({
        lastFollowUpAt: "2026-06-30T04:00:00.000Z",
        lastValidFollowUpAt: "2026-06-30T04:00:00.000Z",
        daysWithoutValidFollowUp: 20,
        reclaimWarningThresholdDays: 20,
      }),
    );
    assert.equal(
      at.findings.find((f) => f.code === "FOLLOW_UP_DAYS_SINCE")?.severity,
      "warning",
    );
  });

  it("flags overdue next follow-up as highest priority", () => {
    const result = buildBasicCustomerAnalysis(
      baseInput({
        nextFollowUpAt: "2026-07-17T04:00:00.000Z",
        requestedProjectName: null,
        hasLatestNextAction: false,
      }),
    );
    assert.equal(result.findings[0]?.code, "FOLLOW_UP_OVERDUE");
    assert.equal(result.summaryStatus, "urgent");
    assert.equal(result.nextRecommendedAction?.type, "ADD_FOLLOW_UP");
  });

  it("suppresses days-since when next follow-up is overdue", () => {
    const result = buildBasicCustomerAnalysis(
      baseInput({
        lastFollowUpAt: "2026-07-01T04:00:00.000Z",
        nextFollowUpAt: "2026-07-10T04:00:00.000Z",
        daysWithoutValidFollowUp: 19,
      }),
    );
    assert.ok(result.findings.some((f) => f.code === "FOLLOW_UP_OVERDUE"));
    assert.equal(
      result.findings.some((f) => f.code === "FOLLOW_UP_DAYS_SINCE"),
      false,
    );
  });

  it("flags missing next follow-up", () => {
    const result = buildBasicCustomerAnalysis(
      baseInput({ nextFollowUpAt: null }),
    );
    assert.ok(result.findings.some((f) => f.code === "NEXT_FOLLOW_UP_MISSING"));
  });

  it("flags missing business need, next action, and contact without leaking values", () => {
    const result = buildBasicCustomerAnalysis(
      baseInput({
        requestedProjectName: null,
        hasLatestNextAction: false,
        phone: null,
        wechatId: null,
      }),
    );
    const codes = result.findings.map((f) => f.code);
    assert.ok(codes.includes("BUSINESS_NEED_MISSING"));
    assert.ok(codes.includes("NEXT_ACTION_MISSING"));
    assert.ok(codes.includes("CONTACT_MISSING"));
    assertBasicAnalysisResponseSafe(result);
    const contact = result.findings.find((f) => f.code === "CONTACT_MISSING");
    assert.equal(contact?.evidence.value, null);
  });

  it("prioritizes and dedupes follow-up gap findings", () => {
    const result = buildBasicCustomerAnalysis(
      baseInput({
        hasAnyFollowUp: false,
        lastFollowUpAt: null,
        lastValidFollowUpAt: null,
        nextFollowUpAt: null,
        hasLatestNextAction: false,
        reclaimEligible: false,
      }),
    );
    const gapCodes = result.findings.filter(
      (f) =>
        f.code === "FOLLOW_UP_NEVER" || f.code === "FOLLOW_UP_DAYS_SINCE",
    );
    assert.equal(gapCodes.length, 1);
    assert.equal(gapCodes[0]?.code, "FOLLOW_UP_NEVER");
  });

  it("keeps deterministic finding order for multi-profile gaps", () => {
    const input = baseInput({
      customerName: null,
      phone: null,
      wechatId: null,
      requestedProjectName: null,
      salesStage: null,
      hasLatestNextAction: false,
      nextFollowUpAt: "2026-07-10T04:00:00.000Z",
    });
    const a = buildBasicCustomerAnalysis(input);
    const b = buildBasicCustomerAnalysis(input);
    assert.deepEqual(
      a.findings.map((f) => f.code),
      b.findings.map((f) => f.code),
    );
    assert.equal(a.findings[0]?.code, "FOLLOW_UP_OVERDUE");
    assert.equal(a.nextRecommendedAction?.type, a.findings[0]?.recommendedAction.type);
  });

  it("reuses reclaim thresholds for approaching reclamation", () => {
    const result = buildBasicCustomerAnalysis(
      baseInput({
        reclaimEligible: true,
        automaticReclaimDays: 30,
        reclaimWarningThresholdDays: 20,
        daysWithoutValidFollowUp: 22,
        lastValidFollowUpAt: "2026-06-28T04:00:00.000Z",
      }),
    );
    const finding = result.findings.find(
      (f) => f.code === "RECLAMATION_APPROACHING",
    );
    assert.ok(finding);
    assert.equal(finding?.severity, "high");
    assert.equal(finding?.recommendedAction.type, "REVIEW_RECLAMATION");
  });

  it("does not invent reclamation when below warning threshold", () => {
    const result = buildBasicCustomerAnalysis(
      baseInput({
        reclaimEligible: true,
        daysWithoutValidFollowUp: 5,
        reclaimWarningThresholdDays: 20,
      }),
    );
    assert.equal(
      result.findings.some((f) => f.code === "RECLAMATION_APPROACHING"),
      false,
    );
  });

  it("is deterministic and does not mutate input", () => {
    const input = baseInput({
      nextFollowUpAt: "2026-07-10T04:00:00.000Z",
      phone: null,
      wechatId: null,
    });
    const snapshot = JSON.stringify(input);
    const a = buildBasicCustomerAnalysis(input);
    const b = buildBasicCustomerAnalysis(input);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(input), snapshot);
  });

  it("handles Asia/Hong_Kong day boundary via ISO timestamps", () => {
    const beforeMidnight = buildBasicCustomerAnalysis(
      baseInput({
        nowIso: "2026-07-19T15:30:00.000Z",
        nextFollowUpAt: "2026-07-19T14:00:00.000Z",
      }),
    );
    assert.ok(
      beforeMidnight.findings.some((f) => f.code === "FOLLOW_UP_OVERDUE"),
    );

    const afterMidnight = buildBasicCustomerAnalysis(
      baseInput({
        nowIso: "2026-07-19T16:30:00.000Z",
        nextFollowUpAt: "2026-07-19T16:00:00.000Z",
      }),
    );
    assert.ok(
      afterMidnight.findings.some((f) => f.code === "FOLLOW_UP_OVERDUE"),
    );
  });
});

describe("isBasicAnalysisReclaimEligible", () => {
  it("excludes public pool, deleted, and non-active customers", () => {
    assert.equal(
      isBasicAnalysisReclaimEligible(
        makeCustomer({ status: "public_pool", ownerId: null }),
      ),
      false,
    );
    assert.equal(
      isBasicAnalysisReclaimEligible(
        makeCustomer({ deletedAt: "2026-07-01T00:00:00.000Z" }),
      ),
      false,
    );
    assert.equal(
      isBasicAnalysisReclaimEligible(makeCustomer({ status: "archived" })),
      false,
    );
    assert.equal(isBasicAnalysisReclaimEligible(makeCustomer()), true);
  });
});
