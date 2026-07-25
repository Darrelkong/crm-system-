import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AiInsightGenerationKeyError,
  buildAiInsightGenerationKey,
  parseAiInsightGenerationKey,
} from "@/lib/ai/customer-insights/feedback-generation-key";
import {
  createFeedbackSnapshotInput,
  mapLegacyFeedback,
  normalizeFeedbackTags,
  serializeFeedbackTags,
  validateComponentFeedbackTarget,
  validateFeedbackRating,
  validateFeedbackTarget,
} from "@/lib/ai/customer-insights/feedback-contract";

describe("buildAiInsightGenerationKey", () => {
  const base = {
    aiInsightId: "ai111111-1111-1111-1111-111111111111",
    insightGeneratedAt: "2026-07-25T03:49:51.935Z",
    sourceHash: "abc123hash",
  };

  it("is deterministic", () => {
    const a = buildAiInsightGenerationKey(base);
    const b = buildAiInsightGenerationKey(base);
    assert.equal(a, b);
    assert.equal(
      a,
      "ai111111-1111-1111-1111-111111111111|2026-07-25T03:49:51.935Z|abc123hash",
    );
  });

  it("changes when generatedAt changes", () => {
    const a = buildAiInsightGenerationKey(base);
    const b = buildAiInsightGenerationKey({
      ...base,
      insightGeneratedAt: "2026-07-25T04:00:00.000Z",
    });
    assert.notEqual(a, b);
  });

  it("changes when sourceHash changes", () => {
    const a = buildAiInsightGenerationKey(base);
    const b = buildAiInsightGenerationKey({ ...base, sourceHash: "other" });
    assert.notEqual(a, b);
  });

  it("changes when insightId changes", () => {
    const a = buildAiInsightGenerationKey(base);
    const b = buildAiInsightGenerationKey({
      ...base,
      aiInsightId: "ai222222-2222-2222-2222-222222222222",
    });
    assert.notEqual(a, b);
  });

  it("trims parts consistently", () => {
    const key = buildAiInsightGenerationKey({
      aiInsightId: ` ${base.aiInsightId} `,
      insightGeneratedAt: ` ${base.insightGeneratedAt} `,
      sourceHash: ` ${base.sourceHash} `,
    });
    assert.equal(key, buildAiInsightGenerationKey(base));
  });

  it("rejects empty fields", () => {
    assert.throws(
      () => buildAiInsightGenerationKey({ ...base, aiInsightId: "  " }),
      AiInsightGenerationKeyError,
    );
    assert.throws(
      () => buildAiInsightGenerationKey({ ...base, sourceHash: "" }),
      AiInsightGenerationKeyError,
    );
  });

  it("rejects invalid timestamp", () => {
    assert.throws(
      () =>
        buildAiInsightGenerationKey({
          ...base,
          insightGeneratedAt: "2026-07-25 03:49:51",
        }),
      AiInsightGenerationKeyError,
    );
  });

  it("rejects separator inside parts", () => {
    assert.throws(
      () =>
        buildAiInsightGenerationKey({
          ...base,
          sourceHash: "a|b",
        }),
      AiInsightGenerationKeyError,
    );
  });

  it("round-trips via parse", () => {
    const key = buildAiInsightGenerationKey(base);
    assert.deepEqual(parseAiInsightGenerationKey(key), {
      aiInsightId: base.aiInsightId,
      insightGeneratedAt: base.insightGeneratedAt,
      sourceHash: base.sourceHash,
    });
  });

  it("matches SQL backfill expression byte-for-byte for ISO-Z rows", () => {
    // Mirrors Migration 0037 CASE expression (trim + concat; delimiter reject).
    function sqlBackfillKey(
      aiInsightId: string,
      insightGeneratedAt: string,
      sourceHash: string,
    ): string | null {
      const a = aiInsightId.trim();
      const g = insightGeneratedAt.trim();
      const s = sourceHash.trim();
      if (a.length === 0 || g.length === 0 || s.length === 0) return null;
      if (a.includes("|") || g.includes("|") || s.includes("|")) return null;
      return `${a}|${g}|${s}`;
    }

    const samples = [
      base,
      {
        ...base,
        insightGeneratedAt: "2026-07-25T03:49:51Z",
      },
      {
        aiInsightId: ` ${base.aiInsightId} `,
        insightGeneratedAt: ` ${base.insightGeneratedAt} `,
        sourceHash: ` ${base.sourceHash} `,
      },
    ];

    for (const sample of samples) {
      const sqlKey = sqlBackfillKey(
        sample.aiInsightId,
        sample.insightGeneratedAt,
        sample.sourceHash,
      );
      const tsKey = buildAiInsightGenerationKey(sample);
      assert.equal(sqlKey, tsKey);
    }

    assert.equal(sqlBackfillKey("a|b", base.insightGeneratedAt, "hash"), null);
    assert.throws(
      () =>
        buildAiInsightGenerationKey({
          ...base,
          sourceHash: "a|b",
        }),
      AiInsightGenerationKeyError,
    );
  });
});

describe("feedback target contract", () => {
  it("accepts exact allowed targets", () => {
    assert.equal(validateFeedbackTarget("base_deep"), "base_deep");
    assert.equal(validateFeedbackTarget("phase2"), "phase2");
    assert.equal(validateFeedbackTarget("suggested_message"), "suggested_message");
    assert.equal(validateFeedbackTarget("legacy_overall"), "legacy_overall");
  });

  it("rejects unknown, uppercase, and padded values", () => {
    assert.equal(validateFeedbackTarget("BASE_DEEP"), null);
    assert.equal(validateFeedbackTarget(" base_deep"), null);
    assert.equal(validateFeedbackTarget("base_deep "), null);
    assert.equal(validateFeedbackTarget("overall"), null);
    assert.equal(validateFeedbackTarget(1), null);
  });

  it("blocks legacy_overall for new component submissions", () => {
    assert.equal(validateComponentFeedbackTarget("legacy_overall"), null);
    assert.equal(validateComponentFeedbackTarget("base_deep"), "base_deep");
  });
});

describe("feedback rating contract", () => {
  it("accepts helpful and not_helpful only", () => {
    assert.equal(validateFeedbackRating("helpful"), "helpful");
    assert.equal(validateFeedbackRating("not_helpful"), "not_helpful");
  });

  it("rejects neutral, integers, and uppercase", () => {
    assert.equal(validateFeedbackRating("neutral"), null);
    assert.equal(validateFeedbackRating("partially_helpful"), null);
    assert.equal(validateFeedbackRating("HELPFUL"), null);
    assert.equal(validateFeedbackRating(5), null);
    assert.equal(validateFeedbackRating("5"), null);
  });
});

describe("feedback tags contract", () => {
  it("accepts target tags and sorts deterministically", () => {
    const tags = normalizeFeedbackTags("base_deep", [
      "outdated_context",
      "accurate_summary",
      "saves_time",
    ]);
    assert.deepEqual(tags, [
      "accurate_summary",
      "saves_time",
      "outdated_context",
    ]);
    assert.equal(
      serializeFeedbackTags(tags!),
      '["accurate_summary","saves_time","outdated_context"]',
    );
  });

  it("rejects cross-target and unknown tags", () => {
    assert.equal(
      normalizeFeedbackTags("base_deep", ["score_reasonable"]),
      null,
    );
    assert.equal(normalizeFeedbackTags("phase2", ["sounds_robotic"]), null);
    assert.equal(normalizeFeedbackTags("suggested_message", ["inaccurate"]), null);
    assert.equal(normalizeFeedbackTags("base_deep", ["not_a_tag"]), null);
  });

  it("dedupes and rejects over max", () => {
    assert.deepEqual(
      normalizeFeedbackTags("base_deep", ["accurate_summary", "accurate_summary"]),
      ["accurate_summary"],
    );
    assert.equal(
      normalizeFeedbackTags("base_deep", [
        "accurate_summary",
        "clear_next_step",
        "useful_risk_identification",
        "saves_time",
        "inaccurate",
      ]),
      null,
    );
  });

  it("allows empty tags", () => {
    assert.deepEqual(normalizeFeedbackTags("phase2", []), []);
  });
});

describe("feedback snapshots", () => {
  it("accepts valid server snapshots", () => {
    const snap = createFeedbackSnapshotInput({
      providerSnapshot: "google_gemini",
      modelSnapshot: "gemini-2.5-flash",
      promptVersionSnapshot: "phase-1d-v1",
      contractModeSnapshot: "gemini_flat",
      phase2GeneratedSnapshot: false,
      actorRoleSnapshot: "admin",
      degradationReasonSnapshot: "missing_signals",
    });
    assert.ok(snap);
    assert.equal(snap?.degradationReasonSnapshot, "missing_signals");
  });

  it("rejects untrusted/invalid snapshot shapes", () => {
    assert.equal(
      createFeedbackSnapshotInput({
        providerSnapshot: "gemini" as "google_gemini",
        modelSnapshot: "gemini-2.5-flash",
        promptVersionSnapshot: "phase-1d-v1",
        contractModeSnapshot: "gemini_flat",
        phase2GeneratedSnapshot: true,
        actorRoleSnapshot: "admin",
      }),
      null,
    );
    assert.equal(
      createFeedbackSnapshotInput({
        providerSnapshot: "google_gemini",
        modelSnapshot: "gemini-2.5-flash",
        promptVersionSnapshot: "phase-1d-v1",
        contractModeSnapshot: "gemini_flat",
        phase2GeneratedSnapshot: "yes" as unknown as boolean,
        actorRoleSnapshot: "admin",
      }),
      null,
    );
  });
});

describe("mapLegacyFeedback", () => {
  it("keeps legacy rating and does not invent component target", () => {
    const mapped = mapLegacyFeedback({
      rating: 5,
      reasonTagsJson: '["robotic_message","other"]',
      comment: "ok",
    });
    assert.deepEqual(mapped, {
      feedbackTarget: "legacy_overall",
      ratingCode: null,
      rating: 5,
      reasonTags: ["robotic_message", "other"],
      comment: "ok",
      providerSnapshot: null,
      contractModeSnapshot: null,
      phase2GeneratedSnapshot: null,
      actorRoleSnapshot: null,
      degradationReasonSnapshot: null,
    });
  });

  it("preserves neutral rating=3 without mapping to helpful/not_helpful", () => {
    const mapped = mapLegacyFeedback({
      rating: 3,
      reasonTagsJson: "[]",
      comment: null,
    });
    assert.equal(mapped?.rating, 3);
    assert.equal(mapped?.ratingCode, null);
    assert.equal(mapped?.feedbackTarget, "legacy_overall");
  });
});
