import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import {
  AI_EFFECT_STATS_DEFAULT_FILTERS,
  buildAiEffectStatsSearchParams,
  buildAiEffectStatsUrl,
  mergeDimensionOptions,
  truncateDimensionLabel,
} from "@/components/admin/ai-effect-stats/ai-effect-stats-filters";
import {
  createAiEffectStatsSequenceGuard,
  fetchAiEffectStats,
} from "@/components/admin/ai-effect-stats/fetch-ai-effect-stats";
import {
  applyAiEffectStatsLoadResult,
  beginAiEffectStatsLoad,
  createInitialAiEffectStatsSession,
} from "@/components/admin/ai-effect-stats/ai-effect-stats-session";
import {
  AI_EFFECT_STATS_DEGRADATION_REASON_CODES,
  componentTagI18nKey,
  degradationReasonI18nKey,
  formatAiEffectCount,
  formatAiEffectRate,
  legacyTagI18nKey,
} from "@/components/admin/ai-effect-stats/format-ai-effect-stats";
import {
  dataQualityHasIssues,
  parseAiEffectStatsClientResponse,
} from "@/components/admin/ai-effect-stats/parse-ai-effect-stats-response";
import { emptyAiEffectStatsResponse } from "@/lib/ai/customer-insights/ai-effect-stats-response";
import { parseAiEffectStatsRequest } from "@/lib/ai/customer-insights/ai-effect-stats-request";
import { AI_EFFECT_PHASE2_DEGRADATION_REASON_ALLOWLIST } from "@/lib/ai/customer-insights/ai-effect-stats-normalize";

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function collectStringKeys(
  value: unknown,
  prefix = "",
  out: string[] = [],
): string[] {
  if (typeof value === "string") {
    out.push(prefix);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const next = prefix ? `${prefix}.${key}` : key;
      collectStringKeys(child, next, out);
    }
  }
  return out;
}

function fixtureStats() {
  const parsed = parseAiEffectStatsRequest(
    new URL("https://example.test/api/admin/ai-effect-stats?range=30"),
  );
  const empty = emptyAiEffectStatsResponse(parsed);
  return {
    ...empty,
    overview: {
      ...empty.overview,
      completedAttempts: 250,
      baseReady: 231,
      failed: 19,
      baseSuccessRate: { numerator: 231, denominator: 250, value: 0.924 },
      refreshFailureRate: { numerator: 19, denominator: 250, value: 0.076 },
      uniqueCustomers: 1250,
      uniqueActors: 12,
      byActorRole: { admin: 40, staff: 200, unknown: 10 },
    },
    failures: { provider: 5, nonProvider: 10, unknownStage: 4 },
    phase2: {
      ...empty.phase2,
      eligibleReady: 100,
      generated: 70,
      safeDegraded: 20,
      unknownOutcome: 10,
      ineligibleReady: 5,
      unknownEligibility: 2,
      generationRate: { numerator: 70, denominator: 90, value: 0.7778 },
      safeDegradationRate: { numerator: 20, denominator: 90, value: 0.2222 },
      degradationReasons: [
        { code: "missing_signals", count: 12 },
        { code: "invalid_evidence", count: 8 },
      ],
    },
    feedback: {
      ...empty.feedback,
      submitted: 40,
      uniqueActors: 8,
      uniqueGenerations: 30,
      byTarget: {
        baseDeep: {
          submittedCount: 20,
          helpfulCount: 15,
          notHelpfulCount: 5,
          helpfulRate: { numerator: 15, denominator: 20, value: 0.75 },
          positiveTags: [{ code: "accurate_summary", count: 9 }],
          negativeTags: [{ code: "too_generic", count: 3 }],
        },
        phase2: {
          submittedCount: 10,
          helpfulCount: 0,
          notHelpfulCount: 0,
          helpfulRate: { numerator: 0, denominator: 0, value: null },
          positiveTags: [],
          negativeTags: [],
        },
        suggestedMessage: {
          submittedCount: 10,
          helpfulCount: 8,
          notHelpfulCount: 2,
          helpfulRate: { numerator: 8, denominator: 10, value: 0.8 },
          positiveTags: [{ code: "ready_to_send", count: 4 }],
          negativeTags: [{ code: "sounds_robotic", count: 2 }],
        },
      },
    },
    legacyFeedback: {
      submittedCount: 5,
      averageRating: 3.4,
      helpfulCount: 2,
      neutralCount: 1,
      notHelpfulCount: 2,
      tagCounts: [{ code: "too_long", count: 2 }],
    },
    dimensions: {
      providers: ["google_gemini"],
      models: ["gemini-2.5-flash", "a".repeat(80)],
      promptVersions: ["v1"],
      contractModes: ["gemini_flat"],
    },
    dataQuality: {
      ...empty.dataQuality,
      unknownProviderEvents: 3,
      malformedAuditMetadataEvents: 1,
    },
  };
}

describe("Phase 5D-5 AI Effect Stats UI — query builder", () => {
  it("builds default query with range=30 only", () => {
    const params = buildAiEffectStatsSearchParams(
      AI_EFFECT_STATS_DEFAULT_FILTERS,
    );
    assert.equal(params.toString(), "range=30");
    assert.equal(
      buildAiEffectStatsUrl(AI_EFFECT_STATS_DEFAULT_FILTERS),
      "/api/admin/ai-effect-stats?range=30",
    );
  });

  it("encodes model and promptVersion with URLSearchParams", () => {
    const url = buildAiEffectStatsUrl({
      ...AI_EFFECT_STATS_DEFAULT_FILTERS,
      range: 7,
      provider: "google_gemini",
      model: "gemini 2.5/flash",
      promptVersion: "v1+beta",
      contractMode: "gemini_flat",
      actorRole: "staff",
      feedbackTarget: "base_deep",
      phase2Generated: "true",
    });
    assert.ok(url.includes("range=7"));
    assert.ok(url.includes("provider=google_gemini"));
    assert.ok(url.includes("model=gemini+2.5%2Fflash"));
    assert.ok(url.includes("promptVersion=v1%2Bbeta"));
    assert.ok(url.includes("feedbackTarget=base_deep"));
    assert.ok(url.includes("phase2Generated=true"));
    assert.equal(url.includes("ai-insight-feedback/stats"), false);
  });

  it("keeps selected dimension when missing from API list", () => {
    const options = mergeDimensionOptions("old-model", ["new-model"]);
    assert.deepEqual(options, ["all", "new-model", "old-model"]);
  });

  it("truncates long dimension labels safely", () => {
    const long = `${"m".repeat(60)}\u0000control`;
    const truncated = truncateDimensionLabel(long, 20);
    assert.ok(truncated.display.length <= 20);
    assert.equal(truncated.display.includes("\u0000"), false);
    assert.ok(truncated.title.includes("m"));
  });
});

describe("Phase 5D-5 AI Effect Stats UI — parse + format", () => {
  it("parses a valid fixture response", () => {
    const parsed = parseAiEffectStatsClientResponse(fixtureStats());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.overview.completedAttempts, 250);
    assert.equal(parsed.feedback.coverageAvailable, false);
    assert.equal(parsed.feedback.coverageValue, null);
  });

  it("rejects malformed responses", () => {
    assert.throws(() => parseAiEffectStatsClientResponse(null));
    assert.throws(() => parseAiEffectStatsClientResponse([]));
    assert.throws(() => parseAiEffectStatsClientResponse({ ok: false }));
    assert.throws(() =>
      parseAiEffectStatsClientResponse({
        ...fixtureStats(),
        overview: undefined,
      }),
    );
    assert.throws(() =>
      parseAiEffectStatsClientResponse({
        ...fixtureStats(),
        phase2: undefined,
      }),
    );
    assert.throws(() =>
      parseAiEffectStatsClientResponse({
        ...fixtureStats(),
        overview: {
          ...fixtureStats().overview,
          baseSuccessRate: { numerator: -1, denominator: 1, value: 0 },
        },
      }),
    );
    assert.throws(() =>
      parseAiEffectStatsClientResponse({
        ...fixtureStats(),
        overview: {
          ...fixtureStats().overview,
          baseSuccessRate: { numerator: 2, denominator: 1, value: 1 },
        },
      }),
    );
    assert.throws(() =>
      parseAiEffectStatsClientResponse({
        ...fixtureStats(),
        overview: {
          ...fixtureStats().overview,
          baseSuccessRate: { numerator: 1, denominator: 1, value: 1.5 },
        },
      }),
    );
    assert.throws(() =>
      parseAiEffectStatsClientResponse({
        ...fixtureStats(),
        overview: {
          ...fixtureStats().overview,
          baseSuccessRate: { numerator: 0, denominator: 0, value: 0 },
        },
      }),
    );
    assert.throws(() =>
      parseAiEffectStatsClientResponse({
        ...fixtureStats(),
        overview: {
          ...fixtureStats().overview,
          completedAttempts: Number.NaN,
        },
      }),
    );
    assert.throws(() =>
      parseAiEffectStatsClientResponse({
        ...fixtureStats(),
        feedback: {
          ...fixtureStats().feedback,
          coverageAvailable: true,
          coverageValue: 0.5,
        },
      }),
    );
    assert.throws(() =>
      parseAiEffectStatsClientResponse({
        ...fixtureStats(),
        phase2: {
          ...fixtureStats().phase2,
          degradationReasons: [{ code: "RAW ERROR!!", count: 1 }],
        },
      }),
    );
    assert.throws(() =>
      parseAiEffectStatsClientResponse({
        ...fixtureStats(),
        dimensions: {
          ...fixtureStats().dimensions,
          models: ["x".repeat(101)],
        },
      }),
    );
  });

  it("strips unexpected PII fields from parsed state", () => {
    const dirty = {
      ...fixtureStats(),
      customerName: "Alice Secret",
      overview: {
        ...fixtureStats().overview,
        actorName: "Staff Person",
      },
    };
    const parsed = parseAiEffectStatsClientResponse(dirty);
    const blob = JSON.stringify(parsed);
    assert.equal(blob.includes("Alice Secret"), false);
    assert.equal(blob.includes("Staff Person"), false);
    assert.equal(blob.includes("customerName"), false);
    assert.equal("customerName" in parsed, false);
  });

  it("formats counts and rates without inventing percentages", () => {
    assert.equal(formatAiEffectCount(1250), "1,250");
    const ok = formatAiEffectRate({
      numerator: 231,
      denominator: 250,
      value: 0.924,
    });
    assert.equal(ok.kind, "percent");
    assert.equal(ok.percentText, "92.4%");
    assert.equal(ok.fractionText, "231 / 250");

    const zeroValue = formatAiEffectRate({
      numerator: 0,
      denominator: 10,
      value: 0,
    });
    assert.equal(zeroValue.kind, "percent");
    assert.equal(zeroValue.percentText, "0%");

    const insufficient = formatAiEffectRate({
      numerator: 0,
      denominator: 0,
      value: null,
    });
    assert.equal(insufficient.kind, "insufficient");
    assert.equal(insufficient.percentText, null);
  });

  it("maps tag and degradation labels via i18n keys", () => {
    assert.equal(
      componentTagI18nKey("base_deep", "accurate_summary"),
      "customers.aiInsightComponentFeedback.tags.base_deep.accurate_summary",
    );
    assert.equal(
      legacyTagI18nKey("too_long"),
      "customers.aiInsightFeedback.reasonTags.too_long",
    );
    assert.equal(
      degradationReasonI18nKey("missing_signals"),
      "aiEffectStats.degradationReasons.missing_signals",
    );
    assert.equal(
      degradationReasonI18nKey("not_a_real_code"),
      "aiEffectStats.degradationReasons.unknown",
    );
    assert.deepEqual(
      [...AI_EFFECT_STATS_DEGRADATION_REASON_CODES],
      [...AI_EFFECT_PHASE2_DEGRADATION_REASON_ALLOWLIST],
    );
  });

  it("shows data quality only when counts are positive", () => {
    assert.equal(
      dataQualityHasIssues({
        legacyRefreshEvents: 0,
        unknownProviderEvents: 0,
        unknownContractEvents: 0,
        unknownActorRoleEvents: 0,
        unknownPhase2OutcomeEvents: 0,
        invalidTagRows: 0,
        malformedAuditMetadataEvents: 0,
      }),
      false,
    );
    assert.equal(
      dataQualityHasIssues({
        legacyRefreshEvents: 0,
        unknownProviderEvents: 1,
        unknownContractEvents: 0,
        unknownActorRoleEvents: 0,
        unknownPhase2OutcomeEvents: 0,
        invalidTagRows: 0,
        malformedAuditMetadataEvents: 0,
      }),
      true,
    );
  });
});

describe("Phase 5D-5 AI Effect Stats UI — fetch lifecycle", () => {
  it("GETs once with default query and parses ok response", async () => {
    const calls: string[] = [];
    const result = await fetchAiEffectStats(AI_EFFECT_STATS_DEFAULT_FILTERS, {
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response(JSON.stringify(fixtureStats()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0], "/api/admin/ai-effect-stats?range=30");
    assert.equal(result.ok, true);
  });

  it("maps 503 data limit, auth, malformed, and generic errors", async () => {
    const dataLimit = await fetchAiEffectStats(
      AI_EFFECT_STATS_DEFAULT_FILTERS,
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              error: "limit",
              code: "AI_EFFECT_STATS_DATA_LIMIT_EXCEEDED",
            }),
            { status: 503 },
          ),
      },
    );
    assert.equal(dataLimit.ok, false);
    if (!dataLimit.ok) assert.equal(dataLimit.kind, "data_limit");

    const auth = await fetchAiEffectStats(AI_EFFECT_STATS_DEFAULT_FILTERS, {
      fetchImpl: async () => new Response("{}", { status: 403 }),
    });
    assert.equal(auth.ok, false);
    if (!auth.ok) assert.equal(auth.kind, "auth");

    const malformed = await fetchAiEffectStats(
      AI_EFFECT_STATS_DEFAULT_FILTERS,
      {
        fetchImpl: async () =>
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
      },
    );
    assert.equal(malformed.ok, false);
    if (!malformed.ok) assert.equal(malformed.kind, "malformed");

    const generic = await fetchAiEffectStats(AI_EFFECT_STATS_DEFAULT_FILTERS, {
      fetchImpl: async () => new Response("{}", { status: 500 }),
    });
    assert.equal(generic.ok, false);
    if (!generic.ok) assert.equal(generic.kind, "generic");
  });

  it("ignores aborted requests via sequence guard", async () => {
    const guard = createAiEffectStatsSequenceGuard();
    const first = guard.begin();
    const second = guard.begin();
    assert.equal(guard.isCurrent(first.sequence), false);
    assert.equal(guard.isCurrent(second.sequence), true);
    assert.equal(first.signal.aborted, true);
    assert.equal(second.signal.aborted, false);
  });

  it("does not call legacy stats endpoint", async () => {
    const calls: string[] = [];
    await fetchAiEffectStats(
      {
        ...AI_EFFECT_STATS_DEFAULT_FILTERS,
        feedbackTarget: "legacy_overall",
      },
      {
        fetchImpl: async (input) => {
          calls.push(String(input));
          return new Response(JSON.stringify(fixtureStats()), { status: 200 });
        },
      },
    );
    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.includes("/api/admin/ai-effect-stats"));
    assert.equal(calls[0]!.includes("ai-insight-feedback/stats"), false);
  });
});

describe("Phase 5D-5 AI Effect Stats UI — source and privacy", () => {
  it("wires panel into admin ai-settings and stops legacy UI fetch", () => {
    const page = readSrc("src/app/(dashboard)/admin/ai-settings/page.tsx");
    const panel = readSrc("src/components/admin/ai-effect-stats-panel.tsx");
    const fetchModule = readSrc(
      "src/components/admin/ai-effect-stats/fetch-ai-effect-stats.ts",
    );
    const filtersModule = readSrc(
      "src/components/admin/ai-effect-stats/ai-effect-stats-filters.ts",
    );
    const legacy = readSrc(
      "src/components/admin/ai-insight-feedback-stats-panel.tsx",
    );

    assert.ok(page.includes("AiEffectStatsPanel"));
    assert.equal(page.includes("AiInsightFeedbackStatsPanel"), false);
    assert.ok(filtersModule.includes("/api/admin/ai-effect-stats"));
    assert.ok(fetchModule.includes("buildAiEffectStatsUrl"));
    assert.equal(panel.includes("ai-insight-feedback/stats"), false);
    assert.equal(fetchModule.includes("ai-insight-feedback/stats"), false);
    assert.equal(panel.includes("setInterval"), false);
    assert.equal(panel.includes("customerName"), false);
    assert.equal(panel.includes("createdByName"), false);
    assert.equal(panel.includes("recentFeedback"), false);
    assert.equal(panel.includes("console.log"), false);
    assert.equal(panel.includes("localStorage"), false);
    assert.equal(panel.includes("sessionStorage"), false);
    assert.ok(panel.includes("aria-pressed="));
    assert.ok(panel.includes('aria-live="polite"'));
    assert.ok(panel.includes('role="alert"'));
    assert.ok(panel.includes("<thead>"));
    assert.ok(panel.includes("aiEffectStats.coverage.unavailable"));
    assert.ok(panel.includes("aiEffectStats.legacy.title"));

    // Legacy panel file remains for backend compatibility tests, but is unused by page.
    assert.ok(legacy.includes("ai-insight-feedback/stats"));
  });

  it("admin layout still guards staff and unauthenticated users", () => {
    const layout = readSrc("src/app/(dashboard)/admin/layout.tsx");
    assert.ok(layout.includes('redirect("/login")'));
    assert.ok(layout.includes('user.role !== "admin"'));
    assert.ok(layout.includes('redirect("/staff")'));
  });

  it("does not introduce forbidden privacy fields in stats UI sources", () => {
    const files = [
      "src/components/admin/ai-effect-stats-panel.tsx",
      "src/components/admin/ai-effect-stats/fetch-ai-effect-stats.ts",
      "src/components/admin/ai-effect-stats/parse-ai-effect-stats-response.ts",
      "src/components/admin/ai-effect-stats/format-ai-effect-stats.ts",
      "src/components/admin/ai-effect-stats/ai-effect-stats-filters.ts",
      "src/components/admin/ai-effect-stats/ai-effect-stats-session.ts",
    ];
    const forbidden = [
      "customerId",
      "customerName",
      "createdByName",
      "actorId",
      "actorName",
      "sourceHash",
      "generationKey",
      "suggestedEmployeeMessage",
      "aiInsightId",
      "phone",
      "wechat",
    ];
    for (const file of files) {
      const src = readSrc(file);
      for (const token of forbidden) {
        assert.equal(
          src.includes(token),
          false,
          `${file} unexpectedly contains ${token}`,
        );
      }
      assert.equal(src.includes("localStorage"), false, file);
      assert.equal(src.includes("sessionStorage"), false, file);
      assert.equal(src.includes("console.log"), false, file);
    }
  });

  it("fixture response stays free of PII keys used by legacy recent list", () => {
    const blob = JSON.stringify(fixtureStats());
    assert.equal(blob.includes("customerName"), false);
    assert.equal(blob.includes("createdByName"), false);
    assert.equal(blob.includes("Alice"), false);
    assert.equal(blob.includes("comment"), false);
  });
});

describe("Phase 5D-5 AI Effect Stats UI — i18n parity", () => {
  it("keeps EN / ZH-Hans / ZH-Hant aiEffectStats key parity", () => {
    const enKeys = collectStringKeys(en.aiEffectStats).sort();
    const hansKeys = collectStringKeys(zhHans.aiEffectStats).sort();
    const hantKeys = collectStringKeys(zhHant.aiEffectStats).sort();
    assert.deepEqual(hansKeys, enKeys);
    assert.deepEqual(hantKeys, enKeys);
  });

  it("covers required titles and degradation reasons without raw codes in copy", () => {
    assert.equal(en.aiEffectStats.title, "AI Effect Analytics");
    assert.equal(zhHans.aiEffectStats.title, "AI 效果统计");
    assert.equal(zhHant.aiEffectStats.title, "AI 效果統計");
    assert.ok(en.aiEffectStats.description.includes("aggregated"));
    assert.ok(zhHant.aiEffectStats.description.includes("內部聚合"));
    assert.equal(
      zhHant.aiEffectStats.coverage.unavailable,
      "反饋覆蓋率暫不可用",
    );
    assert.equal(zhHant.aiEffectStats.legacy.title, "舊版整體評價");
    assert.equal(
      zhHant.aiEffectStats.errors.dataLimit,
      "目前範圍內的統計資料量較大，請縮小篩選範圍後重試。",
    );
    for (const code of AI_EFFECT_STATS_DEGRADATION_REASON_CODES) {
      const enLabel = en.aiEffectStats.degradationReasons[code];
      const hansLabel = zhHans.aiEffectStats.degradationReasons[code];
      const hantLabel = zhHant.aiEffectStats.degradationReasons[code];
      assert.ok(enLabel.length > 0);
      assert.ok(hansLabel.length > 0);
      assert.ok(hantLabel.length > 0);
      assert.notEqual(enLabel, code);
      assert.notEqual(hansLabel, code);
      assert.notEqual(hantLabel, code);
    }
  });

  it("reuses existing component feedback tag labels", () => {
    assert.equal(
      en.customers.aiInsightComponentFeedback.tags.base_deep.accurate_summary,
      "Accurate summary",
    );
    assert.equal(
      zhHant.customers.aiInsightComponentFeedback.tags.base_deep
        .accurate_summary.length > 0,
      true,
    );
  });
});

describe("Phase 5D-5 AI Effect Stats UI — session Strategy A", () => {
  it("reverts filters to last successful values when a filter update fails", () => {
    const initial = createInitialAiEffectStatsSession();
    const successFilters = {
      ...AI_EFFECT_STATS_DEFAULT_FILTERS,
      provider: "google_gemini",
    };
    const afterSuccess = applyAiEffectStatsLoadResult(
      beginAiEffectStatsLoad(initial, successFilters, true),
      successFilters,
      { ok: true, data: parseAiEffectStatsClientResponse(fixtureStats()) },
    );
    assert.equal(afterSuccess.filters.provider, "google_gemini");
    assert.equal(afterSuccess.committedFilters.provider, "google_gemini");
    assert.ok(afterSuccess.stats);

    const failedFilters = {
      ...successFilters,
      provider: "mock",
    };
    const loading = beginAiEffectStatsLoad(afterSuccess, failedFilters, false);
    assert.equal(loading.filters.provider, "mock");

    const afterFail = applyAiEffectStatsLoadResult(loading, failedFilters, {
      ok: false,
      kind: "data_limit",
      status: 503,
      aborted: false,
    });
    assert.equal(afterFail.filters.provider, "google_gemini");
    assert.equal(afterFail.committedFilters.provider, "google_gemini");
    assert.equal(afterFail.stats?.overview.completedAttempts, 250);
    assert.equal(afterFail.loadState.status, "error");
    if (afterFail.loadState.status === "error") {
      assert.equal(afterFail.loadState.kind, "data_limit");
    }
  });

  it("clears stats on auth failure", () => {
    const ready = applyAiEffectStatsLoadResult(
      createInitialAiEffectStatsSession(),
      AI_EFFECT_STATS_DEFAULT_FILTERS,
      { ok: true, data: parseAiEffectStatsClientResponse(fixtureStats()) },
    );
    const afterAuth = applyAiEffectStatsLoadResult(
      beginAiEffectStatsLoad(ready, AI_EFFECT_STATS_DEFAULT_FILTERS, false),
      AI_EFFECT_STATS_DEFAULT_FILTERS,
      { ok: false, kind: "auth", status: 403, aborted: false },
    );
    assert.equal(afterAuth.stats, null);
    assert.equal(afterAuth.loadState.status, "error");
  });
});

describe("Phase 5D-5 AI Effect Stats UI — stale response and side effects", () => {
  it("rapid filter changes keep only the latest successful response", async () => {
    const guard = createAiEffectStatsSequenceGuard();
    let session = createInitialAiEffectStatsSession();
    const calls: string[] = [];

    const first = guard.begin();
    session = beginAiEffectStatsLoad(
      session,
      { ...AI_EFFECT_STATS_DEFAULT_FILTERS, provider: "mock" },
      false,
    );
    const second = guard.begin();
    session = beginAiEffectStatsLoad(
      session,
      { ...AI_EFFECT_STATS_DEFAULT_FILTERS, provider: "google_gemini" },
      false,
    );

    assert.equal(guard.isCurrent(first.sequence), false);
    assert.equal(guard.isCurrent(second.sequence), true);
    assert.equal(first.signal.aborted, true);

    const lateFirst = await fetchAiEffectStats(
      { ...AI_EFFECT_STATS_DEFAULT_FILTERS, provider: "mock" },
      {
        fetchImpl: async (input) => {
          calls.push(String(input));
          return new Response(
            JSON.stringify({
              ...fixtureStats(),
              overview: {
                ...fixtureStats().overview,
                completedAttempts: 1,
              },
            }),
            { status: 200 },
          );
        },
      },
    );
    // Stale: ignore because sequence moved on.
    if (guard.isCurrent(first.sequence) && lateFirst.ok) {
      session = applyAiEffectStatsLoadResult(
        session,
        { ...AI_EFFECT_STATS_DEFAULT_FILTERS, provider: "mock" },
        lateFirst,
      );
    }

    const latest = await fetchAiEffectStats(
      { ...AI_EFFECT_STATS_DEFAULT_FILTERS, provider: "google_gemini" },
      {
        fetchImpl: async (input) => {
          calls.push(String(input));
          return new Response(
            JSON.stringify({
              ...fixtureStats(),
              overview: {
                ...fixtureStats().overview,
                completedAttempts: 99,
              },
            }),
            { status: 200 },
          );
        },
      },
    );
    if (guard.isCurrent(second.sequence) && latest.ok) {
      session = applyAiEffectStatsLoadResult(
        session,
        { ...AI_EFFECT_STATS_DEFAULT_FILTERS, provider: "google_gemini" },
        latest,
      );
    }

    assert.equal(session.stats?.overview.completedAttempts, 99);
    assert.equal(session.filters.provider, "google_gemini");
    assert.equal(calls.length, 2);
    assert.ok(calls.every((url) => url.includes("/api/admin/ai-effect-stats")));
    assert.ok(calls.every((url) => !url.includes("ai-insight-feedback/stats")));
    assert.ok(calls.every((url) => !url.includes("/ai-insight/refresh")));
  });

  it("does not invent coverage percentage from feedback and refresh counts", () => {
    const parsed = parseAiEffectStatsClientResponse(fixtureStats());
    assert.equal(parsed.feedback.coverageAvailable, false);
    assert.equal(parsed.feedback.coverageValue, null);
    const panel = readSrc("src/components/admin/ai-effect-stats-panel.tsx");
    assert.equal(panel.includes("coverageValue"), false);
    assert.equal(panel.includes("Feedback / Refresh"), false);
    assert.ok(panel.includes("aiEffectStats.coverage.unavailable"));
  });

  it("does not recompute phase2 rates from eligible or base ready counts", () => {
    const panel = readSrc("src/components/admin/ai-effect-stats-panel.tsx");
    assert.ok(panel.includes("stats.phase2.generationRate"));
    assert.ok(panel.includes("stats.phase2.safeDegradationRate"));
    assert.equal(panel.includes("eligibleReady /"), false);
    assert.equal(panel.includes("baseReady /"), false);
  });
});