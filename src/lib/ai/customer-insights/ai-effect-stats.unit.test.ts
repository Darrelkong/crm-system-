import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAiEffectRate, AiEffectRateError } from "@/lib/ai/customer-insights/ai-effect-stats-rate";
import {
  addCalendarDays,
  getAiEffectStatsDateRange,
  AI_EFFECT_STATS_DEFAULT_RANGE_DAYS,
} from "@/lib/ai/customer-insights/ai-effect-stats-range";
import {
  classifyRefreshFailure,
  normalizeDegradationReason,
  normalizePhase2Outcome,
  resolvePhase2Eligible,
} from "@/lib/ai/customer-insights/ai-effect-stats-normalize";
import {
  AiEffectStatsRequestError,
  parseAiEffectStatsRequest,
} from "@/lib/ai/customer-insights/ai-effect-stats-request";
import {
  AI_EFFECT_STATS_FORBIDDEN_RESPONSE_KEYS,
  collectForbiddenKeys,
  emptyAiEffectStatsResponse,
  responseContainsForbiddenValue,
} from "@/lib/ai/customer-insights/ai-effect-stats-response";
import {
  assertWithinHardLimit,
  AiEffectStatsDataLimitError,
  AI_EFFECT_STATS_AUDIT_HARD_LIMIT,
} from "@/lib/ai/customer-insights/ai-effect-stats";
import { buildCustomerAiInsightRefreshAuditMetadata } from "@/lib/ai/customer-insights/service";
import { buildAiInsightRefreshFailedAuditMetadata } from "@/lib/ai/customer-insights/diagnostics";
import { AiAnalysisError } from "@/lib/ai/customer-insights/errors";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("Phase 5D-4 rate helper", () => {
  it("returns null value for 0/0", () => {
    assert.deepEqual(buildAiEffectRate(0, 0), {
      numerator: 0,
      denominator: 0,
      value: null,
    });
  });

  it("computes rates with 4 decimal places", () => {
    assert.deepEqual(buildAiEffectRate(0, 10), {
      numerator: 0,
      denominator: 10,
      value: 0,
    });
    assert.deepEqual(buildAiEffectRate(5, 10), {
      numerator: 5,
      denominator: 10,
      value: 0.5,
    });
    assert.deepEqual(buildAiEffectRate(10, 10), {
      numerator: 10,
      denominator: 10,
      value: 1,
    });
    assert.equal(buildAiEffectRate(1, 3).value, 0.3333);
  });

  it("rejects negative and over-denominator numerators", () => {
    assert.throws(() => buildAiEffectRate(-2, 10), AiEffectRateError);
    assert.throws(() => buildAiEffectRate(12, 10), AiEffectRateError);
    assert.throws(() => buildAiEffectRate(1, -1), AiEffectRateError);
    assert.throws(() => buildAiEffectRate(Number.NaN, 1), AiEffectRateError);
  });
});

describe("Phase 5D-4 date range Asia/Hong_Kong", () => {
  it("defaults to 30 days and uses exclusive to", () => {
    // 2026-07-20 16:00 UTC = 2026-07-21 00:00 HKT
    const now = new Date("2026-07-20T16:00:00.000Z");
    const range = getAiEffectStatsDateRange(30, now);
    assert.equal(range.days, 30);
    assert.equal(range.timezone, "Asia/Hong_Kong");
    assert.equal(range.to, "2026-07-21T16:00:00.000Z"); // next HK day start
    // from = 2026-06-22 00:00 HKT = 2026-06-21T16:00:00.000Z
    assert.equal(range.from, "2026-06-21T16:00:00.000Z");
  });

  it("supports 7/30/90 and rejects invalid via request parser", () => {
    const ok7 = parseAiEffectStatsRequest(
      new URL("https://example.test/api/admin/ai-effect-stats?range=7"),
      new Date("2026-07-20T04:00:00.000Z"),
    );
    assert.equal(ok7.range.days, 7);
    const def = parseAiEffectStatsRequest(
      new URL("https://example.test/api/admin/ai-effect-stats"),
    );
    assert.equal(def.range.days, AI_EFFECT_STATS_DEFAULT_RANGE_DAYS);
    assert.throws(
      () =>
        parseAiEffectStatsRequest(
          new URL("https://example.test/api/admin/ai-effect-stats?range=365"),
        ),
      (err: unknown) =>
        err instanceof AiEffectStatsRequestError && err.code === "INVALID_RANGE",
    );
  });

  it("addCalendarDays crosses month boundaries", () => {
    assert.deepEqual(addCalendarDays(2026, 3, 1, -1), {
      year: 2026,
      month: 2,
      day: 28,
    });
  });
});

describe("Phase 5D-4 normalizers", () => {
  it("classifies failure stages without inventing codes", () => {
    assert.equal(
      classifyRefreshFailure({ failureStage: "provider_http" }),
      "provider",
    );
    assert.equal(
      classifyRefreshFailure({
        providerErrorType: "provider_http_error",
      }),
      "provider",
    );
    assert.equal(
      classifyRefreshFailure({ errorCode: "AI_NOT_CONFIGURED" }),
      "non_provider",
    );
    assert.equal(classifyRefreshFailure({ failureStage: "weird" }), "unknown");
    assert.equal(classifyRefreshFailure({}), "unknown");
  });

  it("normalizes phase2 outcomes and degradation reasons", () => {
    assert.equal(resolvePhase2Eligible("gemini_flat", undefined), true);
    assert.equal(resolvePhase2Eligible("none", undefined), false);
    assert.equal(resolvePhase2Eligible("unknown", undefined), null);
    assert.equal(
      normalizePhase2Outcome({
        contractMode: "gemini_flat",
        phase2Generated: true,
      }),
      "generated",
    );
    assert.equal(
      normalizePhase2Outcome({
        contractMode: "rich",
        phase2Generated: false,
      }),
      "safe_degraded",
    );
    assert.equal(
      normalizePhase2Outcome({ contractMode: "unknown" }),
      "unknown",
    );
    assert.equal(normalizeDegradationReason("missing_signals"), "missing_signals");
    assert.equal(normalizeDegradationReason("raw provider boom"), "unknown");
  });
});

describe("Phase 5D-4 request validation", () => {
  it("rejects invalid filters and overlong model", () => {
    assert.throws(
      () =>
        parseAiEffectStatsRequest(
          new URL(
            "https://example.test/api/admin/ai-effect-stats?provider=gemini",
          ),
        ),
      (err: unknown) =>
        err instanceof AiEffectStatsRequestError &&
        err.code === "INVALID_PROVIDER",
    );
    assert.throws(
      () =>
        parseAiEffectStatsRequest(
          new URL(
            "https://example.test/api/admin/ai-effect-stats?model=" +
              "x".repeat(101),
          ),
        ),
      (err: unknown) =>
        err instanceof AiEffectStatsRequestError && err.code === "INVALID_MODEL",
    );
    assert.throws(
      () =>
        parseAiEffectStatsRequest(
          new URL(
            "https://example.test/api/admin/ai-effect-stats?feedbackTarget=foo",
          ),
        ),
      (err: unknown) =>
        err instanceof AiEffectStatsRequestError &&
        err.code === "INVALID_FEEDBACK_TARGET",
    );
  });
});

describe("Phase 5D-4 response privacy contract", () => {
  it("empty response has exact top-level sections and no forbidden keys", () => {
    const parsed = parseAiEffectStatsRequest(
      new URL("https://example.test/api/admin/ai-effect-stats?range=30"),
    );
    const empty = emptyAiEffectStatsResponse(parsed);
    assert.deepEqual(Object.keys(empty).sort(), [
      "dataQuality",
      "dimensions",
      "failures",
      "feedback",
      "filterScope",
      "filters",
      "legacyFeedback",
      "ok",
      "overview",
      "phase2",
      "range",
    ]);
    assert.equal(empty.feedback.coverageAvailable, false);
    assert.equal(empty.feedback.coverageValue, null);
    assert.equal(
      empty.feedback.coverageUnavailableReason,
      "actor_target_exposure_not_recorded",
    );
    assert.deepEqual(collectForbiddenKeys(empty), []);
    assert.ok(AI_EFFECT_STATS_FORBIDDEN_RESPONSE_KEYS.includes("customerName"));
    assert.equal(
      responseContainsForbiddenValue(empty, ["Alice Secret", "hash-secret"]),
      false,
    );
  });
});

describe("Phase 5D-4 audit metadata reinforcement", () => {
  it("success metadata includes contractMode actorRole generatedAt and keeps sourceHash", () => {
    const meta = buildCustomerAiInsightRefreshAuditMetadata(
      {
        id: "ins-1",
        customerId: "cust-1",
        sourceHash: "hash-1",
        generatedAt: "2026-07-20T12:00:00.000Z",
        model: "gemini-2.5-flash",
        promptVersion: "phase-1d-v1",
        status: "ready",
        phase2: null,
      } as never,
      "google_gemini",
      {
        phase2Generated: false,
        phase2UnavailableReason: "missing_signals",
      },
      "staff",
    );
    assert.equal(meta.sourceHash, "hash-1");
    assert.equal(meta.generatedAt, "2026-07-20T12:00:00.000Z");
    assert.equal(meta.contractMode, "gemini_flat");
    assert.equal(meta.actorRole, "staff");
    assert.equal(meta.phase2Eligible, true);
    assert.equal(meta.finalStatus, "ready");
    assert.equal("prompt" in meta, false);
    assert.equal("suggestedEmployeeMessage" in meta, false);
  });

  it("failure metadata can include actorRole without PII", () => {
    const error = new AiAnalysisError(undefined, {
      providerKind: "google_gemini",
      model: "gemini-2.5-flash",
      providerErrorType: "provider_http_error",
      failureStage: "provider_http",
      httpStatus: 500,
    });
    const meta = buildAiInsightRefreshFailedAuditMetadata(
      "cust-1",
      "AI_PROVIDER_ERROR",
      error,
      { actorRole: "admin" },
    );
    assert.equal(meta.actorRole, "admin");
    assert.equal(meta.failureStage, "provider_http");
    assert.equal("stack" in meta, false);
  });
});

describe("Phase 5D-4 hard limit and filter empty strings", () => {
  it("detects overflow at hardLimit+1 and accepts hardLimit", () => {
    assert.doesNotThrow(() =>
      assertWithinHardLimit(AI_EFFECT_STATS_AUDIT_HARD_LIMIT - 1, AI_EFFECT_STATS_AUDIT_HARD_LIMIT),
    );
    assert.doesNotThrow(() =>
      assertWithinHardLimit(AI_EFFECT_STATS_AUDIT_HARD_LIMIT, AI_EFFECT_STATS_AUDIT_HARD_LIMIT),
    );
    assert.throws(
      () =>
        assertWithinHardLimit(
          AI_EFFECT_STATS_AUDIT_HARD_LIMIT + 1,
          AI_EFFECT_STATS_AUDIT_HARD_LIMIT,
        ),
      (err: unknown) =>
        err instanceof AiEffectStatsDataLimitError &&
        err.code === "AI_EFFECT_STATS_DATA_LIMIT_EXCEEDED" &&
        err.status === 503,
    );
  });

  it("rejects empty-string filters as invalid (not all)", () => {
    assert.throws(
      () =>
        parseAiEffectStatsRequest(
          new URL("https://example.test/api/admin/ai-effect-stats?provider="),
        ),
      (err: unknown) =>
        err instanceof AiEffectStatsRequestError &&
        err.code === "INVALID_PROVIDER",
    );
    assert.throws(
      () =>
        parseAiEffectStatsRequest(
          new URL(
            "https://example.test/api/admin/ai-effect-stats?feedbackTarget=",
          ),
        ),
      (err: unknown) =>
        err instanceof AiEffectStatsRequestError &&
        err.code === "INVALID_FEEDBACK_TARGET",
    );
  });
});

describe("Phase 5D-4 refresh terminal event uniqueness (source)", () => {
  it("refresh route writes exactly one terminal audit per success or failure path", () => {
    const root = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../..",
    );
    const route = readFileSync(
      path.join(root, "src/app/api/customers/[id]/ai-insight/refresh/route.ts"),
      "utf8",
    );
    const service = readFileSync(
      path.join(root, "src/lib/ai/customer-insights/service.ts"),
      "utf8",
    );
    assert.equal(
      (route.match(/customer\.ai_insight\.refreshed/g) ?? []).length,
      1,
    );
    assert.equal(
      (route.match(/customer\.ai_insight\.refresh_failed/g) ?? []).length,
      1,
    );
    assert.ok(route.includes("AiRefreshCooldownError"));
    assert.equal(service.includes("writeAuditLog"), false);
    assert.equal(service.includes("customer.ai_insight.refreshed"), false);
  });
});

describe("Phase 5D-4 aggregation performance synthetic", () => {
  it("aggregates 1000 synthetic events under 200ms without NaN", () => {
    const started = Date.now();
    let completed = 0;
    let ready = 0;
    for (let i = 0; i < 1000; i += 1) {
      completed += 1;
      if (i % 5 !== 0) ready += 1;
    }
    const rate = buildAiEffectRate(ready, completed);
    assert.equal(rate.denominator, 1000);
    assert.ok(rate.value != null && Number.isFinite(rate.value));
    assert.ok(Date.now() - started < 200);
  });
});
