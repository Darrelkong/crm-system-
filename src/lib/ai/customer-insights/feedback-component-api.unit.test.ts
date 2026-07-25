import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseComponentFeedbackPutBody,
  AI_FEEDBACK_COMPONENT_MAX_BODY_BYTES,
} from "@/lib/ai/customer-insights/feedback-component-request";
import {
  resolveComponentFeedbackEligibility,
  isComponentTargetEligible,
  resolvePhase2GeneratedSnapshot,
} from "@/lib/ai/customer-insights/feedback-component-eligibility";
import { buildComponentFeedbackAuditMetadata } from "@/lib/ai/customer-insights/feedback-component-audit";
import type { CustomerAiInsightView } from "@/lib/ai/customer-insights/service";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import type { ComponentFeedbackView } from "@/lib/ai/customer-insights/feedback-repository";
import { PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER } from "@/lib/ai/customer-insights/safe-suggested-message";
import { PHASE2_VERSION } from "@/lib/ai/phase2/types";
import type { Phase2Insight } from "@/lib/ai/phase2/types";

const settingsOn = {
  aiShowDraftMessage: true,
} as EffectiveAiSettings;

const settingsOff = {
  aiShowDraftMessage: false,
} as EffectiveAiSettings;

function minimalPhase2(): Phase2Insight {
  return {
    version: PHASE2_VERSION,
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
    painPoints: [],
    churnRisk: {
      level: "insufficient_data",
      confidence: "low",
      customerBehaviorRisk: [],
      crmProcessRisk: [],
      evidence: [],
      summary: "Insufficient",
    },
    followUpRecommendation: {
      date: null,
      timeWindow: null,
      channel: null,
      topic: null,
      confidence: "low",
      basis: [],
      insufficientDataReason: "none",
    },
    missingInformation: [],
  };
}

function readyInsight(
  overrides: Partial<CustomerAiInsightView> = {},
): CustomerAiInsightView {
  return {
    id: "insight-1",
    customerId: "customer-1",
    intentLevel: "medium",
    intentScore: 50,
    customerSummary: "summary",
    currentSituation: "situation",
    keySignals: [],
    riskFlags: [],
    missingInformation: [],
    nextBestAction: "follow",
    suggestedFollowUpAt: null,
    suggestedEmployeeMessage: "你好，想跟进一下项目进度。",
    confidence: 0.5,
    reasoning: "reason",
    model: "gemini-2.5-flash",
    promptVersion: "v1",
    sourceHash: "hash-1",
    status: "ready",
    generatedAt: "2026-07-20T10:00:00.000Z",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
    phase2: null,
    ...overrides,
  };
}

describe("Phase 5D-2 component feedback request parse", () => {
  it("accepts minimal valid body", () => {
    const parsed = parseComponentFeedbackPutBody({
      insightGeneratedAt: "2026-07-20T10:00:00.000Z",
      sourceHash: "abc",
      target: "base_deep",
      rating: "helpful",
      tags: ["accurate_summary"],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.target, "base_deep");
    assert.deepEqual(parsed.value.tags, ["accurate_summary"]);
  });

  it("rejects unknown top-level fields and comment", () => {
    assert.equal(
      parseComponentFeedbackPutBody({
        insightGeneratedAt: "2026-07-20T10:00:00.000Z",
        sourceHash: "abc",
        target: "base_deep",
        rating: "helpful",
        tags: [],
        generationKey: "x",
      }).ok,
      false,
    );
    const comment = parseComponentFeedbackPutBody({
      insightGeneratedAt: "2026-07-20T10:00:00.000Z",
      sourceHash: "abc",
      target: "base_deep",
      rating: "helpful",
      tags: [],
      comment: "nope",
    });
    assert.equal(comment.ok, false);
    if (comment.ok) return;
    assert.equal(comment.errorCode, "AI_FEEDBACK_COMMENT_NOT_ALLOWED");
  });

  it("rejects legacy target, integer rating, and cross-target tags", () => {
    const legacy = parseComponentFeedbackPutBody({
      insightGeneratedAt: "2026-07-20T10:00:00.000Z",
      sourceHash: "abc",
      target: "legacy_overall",
      rating: "helpful",
      tags: [],
    });
    assert.equal(legacy.ok, false);
    if (!legacy.ok) {
      assert.equal(legacy.errorCode, "AI_FEEDBACK_TARGET_NOT_ALLOWED");
    }

    const rating = parseComponentFeedbackPutBody({
      insightGeneratedAt: "2026-07-20T10:00:00.000Z",
      sourceHash: "abc",
      target: "base_deep",
      rating: 5,
      tags: [],
    });
    assert.equal(rating.ok, false);

    const tags = parseComponentFeedbackPutBody({
      insightGeneratedAt: "2026-07-20T10:00:00.000Z",
      sourceHash: "abc",
      target: "base_deep",
      rating: "not_helpful",
      tags: ["score_reasonable"],
    });
    assert.equal(tags.ok, false);

    const tooMany = parseComponentFeedbackPutBody({
      insightGeneratedAt: "2026-07-20T10:00:00.000Z",
      sourceHash: "abc",
      target: "base_deep",
      rating: "helpful",
      tags: [
        "accurate_summary",
        "clear_next_step",
        "useful_risk_identification",
        "saves_time",
        "accurate_summary",
      ],
    });
    // duplicate would normalize but 5 distinct after unique? wait - 4 unique + duplicate of first
    // tags length is 5 so fails before dedupe
    assert.equal(tooMany.ok, false);
  });

  it("bounds body size constant to 8 KiB", () => {
    assert.equal(AI_FEEDBACK_COMPONENT_MAX_BODY_BYTES, 8 * 1024);
  });
});

describe("Phase 5D-2 component feedback eligibility", () => {
  it("marks base eligible for ready non-mock insight", () => {
    const eligibility = resolveComponentFeedbackEligibility(
      readyInsight(),
      settingsOn,
    );
    assert.equal(eligibility.baseDeep, true);
    assert.equal(eligibility.phase2, false);
    assert.equal(eligibility.suggestedMessage, true);
  });

  it("requires renderable phase2 and safe message settings", () => {
    const withPhase2 = readyInsight({ phase2: minimalPhase2() });
    assert.equal(
      resolveComponentFeedbackEligibility(withPhase2, settingsOn).phase2,
      true,
    );
    assert.equal(resolvePhase2GeneratedSnapshot(withPhase2), true);

    assert.equal(
      resolveComponentFeedbackEligibility(readyInsight(), settingsOff)
        .suggestedMessage,
      false,
    );
    assert.equal(
      resolveComponentFeedbackEligibility(
        readyInsight({
          suggestedEmployeeMessage: PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER,
        }),
        settingsOn,
      ).suggestedMessage,
      false,
    );
    assert.equal(
      resolveComponentFeedbackEligibility(readyInsight(), null).suggestedMessage,
      false,
    );
  });

  it("rejects mock and failed insights for all targets", () => {
    const mock = resolveComponentFeedbackEligibility(
      readyInsight({ model: "mock-customer-insight-v1" }),
      settingsOn,
    );
    assert.deepEqual(mock, {
      baseDeep: false,
      phase2: false,
      suggestedMessage: false,
    });

    const failed = resolveComponentFeedbackEligibility(
      readyInsight({ status: "failed" }),
      settingsOn,
    );
    assert.equal(failed.baseDeep, false);
    assert.equal(isComponentTargetEligible(failed, "base_deep"), false);
  });
});

describe("Phase 5D-2 component feedback audit privacy", () => {
  it("omits sourceHash, generationKey, comment, and customer content", () => {
    const feedback = {
      id: "fb-1",
      customerId: "cust",
      aiInsightId: "ins",
      insightGeneratedAt: "2026-07-20T10:00:00.000Z",
      sourceHash: "secret-hash",
      generationKey: "secret-key",
      feedbackTarget: "base_deep",
      ratingCode: "helpful",
      reasonTags: ["accurate_summary"],
      comment: null,
      model: "gemini-2.5-flash",
      promptVersion: "v1",
      providerSnapshot: "google_gemini",
      contractModeSnapshot: "gemini_flat",
      phase2GeneratedSnapshot: false,
      actorRoleSnapshot: "staff",
      degradationReasonSnapshot: null,
      createdBy: "user-1",
      createdAt: "2026-07-20T10:01:00.000Z",
      updatedAt: "2026-07-20T10:01:00.000Z",
      updatedBy: null,
    } as ComponentFeedbackView;

    const meta = buildComponentFeedbackAuditMetadata(feedback, "create");
    const serialized = JSON.stringify(meta);
    assert.equal(serialized.includes("secret-hash"), false);
    assert.equal(serialized.includes("secret-key"), false);
    assert.equal(serialized.includes("comment"), false);
    assert.equal("sourceHash" in meta, false);
    assert.equal("generationKey" in meta, false);
    assert.equal(meta.feedbackTarget, "base_deep");
    assert.equal(meta.ratingCode, "helpful");
    assert.deepEqual(meta.reasonTagCodes, ["accurate_summary"]);
    assert.equal(meta.operation, "create");
  });
});

describe("Phase 5D-2 body limit + exact keys + i18n", () => {
  it("rejects oversized bodies before JSON parse via readLimitedJsonBody", async () => {
    const { readLimitedJsonBody } = await import(
      "@/lib/http/read-limited-json-body"
    );
    const { AI_FEEDBACK_COMPONENT_MAX_BODY_BYTES } = await import(
      "@/lib/ai/customer-insights/feedback-component-request"
    );

    const oversized = "x".repeat(AI_FEEDBACK_COMPONENT_MAX_BODY_BYTES + 1);
    const byHeader = new Request("http://localhost/test", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "content-length": String(oversized.length),
      },
      body: oversized,
    });
    const headerResult = await readLimitedJsonBody(
      byHeader,
      AI_FEEDBACK_COMPONENT_MAX_BODY_BYTES,
    );
    assert.equal(headerResult.ok, false);
    if (!headerResult.ok) {
      assert.equal(headerResult.httpStatus, 413);
    }

    const exactlyMax = `{${"\"a\":".padEnd(AI_FEEDBACK_COMPONENT_MAX_BODY_BYTES - 2, "1")}}`;
    // Prefer a valid small JSON under limit
    const under = new Request("http://localhost/test", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        insightGeneratedAt: "2026-07-20T10:00:00.000Z",
        sourceHash: "abc",
        target: "base_deep",
        rating: "helpful",
        tags: [],
      }),
    });
    const underResult = await readLimitedJsonBody(
      under,
      AI_FEEDBACK_COMPONENT_MAX_BODY_BYTES,
    );
    assert.equal(underResult.ok, true);
    void exactlyMax;

    const empty = await readLimitedJsonBody(
      new Request("http://localhost/test", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "",
      }),
      AI_FEEDBACK_COMPONENT_MAX_BODY_BYTES,
    );
    assert.equal(empty.ok, false);

    const malformed = await readLimitedJsonBody(
      new Request("http://localhost/test", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
      AI_FEEDBACK_COMPONENT_MAX_BODY_BYTES,
    );
    assert.equal(malformed.ok, false);
  });

  it("rejects null/array bodies and client snapshot fields", () => {
    assert.equal(parseComponentFeedbackPutBody(null).ok, false);
    assert.equal(parseComponentFeedbackPutBody([]).ok, false);
    for (const field of [
      "generationKey",
      "actorUserId",
      "providerSnapshot",
      "aiInsightId",
      "customerId",
    ]) {
      const parsed = parseComponentFeedbackPutBody({
        insightGeneratedAt: "2026-07-20T10:00:00.000Z",
        sourceHash: "abc",
        target: "base_deep",
        rating: "helpful",
        tags: [],
        [field]: "x",
      });
      assert.equal(parsed.ok, false);
    }
  });

  it("safe response key paths stay within allowlist", async () => {
    const {
      assertComponentFeedbackSafeResponseKeys,
      collectComponentFeedbackResponseDeepKeys,
    } = await import("@/lib/ai/customer-insights/feedback-component-api");

    const empty = {
      ok: true as const,
      generation: null,
      eligibility: {
        baseDeep: false,
        phase2: false,
        suggestedMessage: false,
      },
      feedback: {
        baseDeep: null,
        phase2: null,
        suggestedMessage: null,
      },
    };
    assertComponentFeedbackSafeResponseKeys(empty);
    assert.ok(
      collectComponentFeedbackResponseDeepKeys(empty).includes("generation"),
    );

    const filled = {
      ok: true as const,
      generation: {
        insightGeneratedAt: "2026-07-20T10:00:00.000Z",
        sourceHash: "hash",
      },
      eligibility: {
        baseDeep: true,
        phase2: false,
        suggestedMessage: true,
      },
      feedback: {
        baseDeep: {
          rating: "helpful" as const,
          tags: ["accurate_summary" as const],
          updatedAt: "2026-07-20T10:01:00.000Z",
        },
        phase2: null,
        suggestedMessage: null,
      },
    };
    assertComponentFeedbackSafeResponseKeys(filled);
  });

  it("resolves all AI_FEEDBACK error codes in en/zh-Hans/zh-Hant", async () => {
    const { resolveApiError } = await import("@/i18n/resolve-api-error");
    const en = (await import("@/i18n/locales/en")).default;
    const zhHans = (await import("@/i18n/locales/zh-Hans")).default;
    const zhHant = (await import("@/i18n/locales/zh-Hant")).default;

    function tFrom(messages: typeof en | typeof zhHans | typeof zhHant) {
      return (key: string) => {
        const parts = key.split(".");
        let cur: unknown = messages;
        for (const part of parts) {
          if (!cur || typeof cur !== "object") return key;
          cur = (cur as Record<string, unknown>)[part];
        }
        return typeof cur === "string" ? cur : key;
      };
    }

    const codes = [
      "AI_FEEDBACK_INSIGHT_NOT_FOUND",
      "AI_FEEDBACK_INSIGHT_NOT_READY",
      "AI_FEEDBACK_GENERATION_MISMATCH",
      "AI_FEEDBACK_INVALID_REQUEST",
      "AI_FEEDBACK_INVALID_TARGET",
      "AI_FEEDBACK_TARGET_NOT_ALLOWED",
      "AI_FEEDBACK_TARGET_NOT_ELIGIBLE",
      "AI_FEEDBACK_INVALID_RATING",
      "AI_FEEDBACK_INVALID_TAGS",
      "AI_FEEDBACK_COMMENT_NOT_ALLOWED",
      "AI_FEEDBACK_BODY_TOO_LARGE",
      "AI_FEEDBACK_SNAPSHOT_UNAVAILABLE",
      "AI_FEEDBACK_WRITE_FAILED",
    ] as const;

    const tEn = tFrom(en);
    const tHans = tFrom(zhHans);
    const tHant = tFrom(zhHant);
    for (const code of codes) {
      const enMsg = resolveApiError(tEn, { errorCode: code });
      const hansMsg = resolveApiError(tHans, { errorCode: code });
      const hantMsg = resolveApiError(tHant, { errorCode: code });
      assert.notEqual(enMsg, code);
      assert.notEqual(hansMsg, code);
      assert.notEqual(hantMsg, code);
      assert.equal(enMsg.includes("sourceHash"), false);
      assert.equal(hansMsg.includes("generationKey"), false);
    }
  });
});
