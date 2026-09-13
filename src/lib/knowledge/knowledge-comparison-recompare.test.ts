import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { KnowledgeComparisonDetail } from "@/lib/knowledge/comparison-types";
import {
  areKnowledgeComparisonsSemanticallyEqual,
  formatKnowledgeComparisonLastComparedAt,
  shouldBlockManualRecompare,
} from "@/lib/knowledge/knowledge-comparison-orchestration";

const root = process.cwd();

function sampleComparison(
  overrides: Partial<KnowledgeComparisonDetail> = {},
): KnowledgeComparisonDetail {
  return {
    id: "run-1",
    sourceId: "source-1",
    organizationRunId: "org-1",
    status: "completed",
    relationship: "update_existing",
    matchedArticleId: "article-1",
    matchedArticleVersionId: "version-1",
    matchedVersionNumber: 1,
    matchConfidence: 0.92,
    candidateSnapshot: [],
    comparison: {
      relationship: "update_existing",
      matchedCandidateKey: "C1",
      matchConfidence: 0.92,
      newFacts: [
        {
          id: "n1",
          topic: "资产要求",
          existingValue: null,
          incomingValue: "50万",
          explanation: "新增门槛",
          confidence: 0.9,
          sourceExcerpt: null,
          existingExcerpt: null,
        },
      ],
      changedFacts: [],
      conflicts: [],
      uncertainties: [],
      suggestedUpdates: [],
    },
    degradationLevel: null,
    provider: "mock",
    model: "mock",
    failureCode: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

describe("knowledge comparison recompare UX", () => {
  it("blocks duplicate manual recompare while one request is in flight", () => {
    assert.equal(
      shouldBlockManualRecompare({ inFlight: true, comparing: false }),
      true,
    );
    assert.equal(
      shouldBlockManualRecompare({ inFlight: false, comparing: true }),
      true,
    );
    assert.equal(
      shouldBlockManualRecompare({ inFlight: false, comparing: false }),
      false,
    );
  });

  it("treats run metadata-only differences as unchanged", () => {
    const previous = sampleComparison();
    const next = sampleComparison({
      id: "run-2",
      createdAt: "2026-09-13T06:30:00.000Z",
      completedAt: "2026-09-13T06:36:00.000Z",
      provider: "qwen",
      model: "qwen-vl",
      comparison: {
        ...previous.comparison!,
        newFacts: [
          {
            ...previous.comparison!.newFacts[0],
            id: "n2",
          },
        ],
      },
    });

    assert.equal(areKnowledgeComparisonsSemanticallyEqual(previous, next), true);
  });

  it("detects structured semantic differences", () => {
    const previous = sampleComparison();
    const next = sampleComparison({
      id: "run-2",
      completedAt: "2026-09-13T06:36:00.000Z",
      comparison: {
        ...previous.comparison!,
        newFacts: [
          {
            ...previous.comparison!.newFacts[0],
            id: "n2",
            incomingValue: "100万",
          },
        ],
      },
    });

    assert.equal(
      areKnowledgeComparisonsSemanticallyEqual(previous, next),
      false,
    );
  });

  it("formats last-compared timestamps for supported locales", () => {
    const formatted = formatKnowledgeComparisonLastComparedAt(
      "2026-09-13T06:36:00.000Z",
      "zh-Hant",
    );
    assert.match(formatted, /2026/);
    assert.match(formatted, /36/);
    assert.notEqual(
      formatKnowledgeComparisonLastComparedAt(
        "2026-09-13T06:36:00.000Z",
        "en",
      ),
      "",
    );
    assert.notEqual(
      formatKnowledgeComparisonLastComparedAt(
        "2026-09-13T06:36:00.000Z",
        "zh-Hans",
      ),
      "",
    );
  });

  it("exposes loading, disabled, feedback, and mobile-safe recompare UI", () => {
    const panel = readFileSync(
      join(root, "src/components/knowledge/knowledge-comparison-panel.tsx"),
      "utf8",
    );
    const hook = readFileSync(
      join(root, "src/lib/knowledge/use-knowledge-source-comparison.ts"),
      "utf8",
    );
    const zhHant = readFileSync(
      join(root, "src/i18n/locales/zh-Hant.ts"),
      "utf8",
    );
    const zhHans = readFileSync(
      join(root, "src/i18n/locales/zh-Hans.ts"),
      "utf8",
    );
    const en = readFileSync(join(root, "src/i18n/locales/en.ts"), "utf8");

    assert.match(panel, /recomparingAction/);
    assert.match(panel, /aria-busy=\{recomparing\}/);
    assert.match(panel, /disabled=\{processing\}/);
    assert.match(panel, /recompareUpdated/);
    assert.match(panel, /recompareUnchangedBody/);
    assert.match(panel, /recompareFailed/);
    assert.match(panel, /data-comparison-last-compared/);
    assert.match(panel, /min-w-\[7\.5rem\]/);
    assert.match(panel, /whitespace-pre-wrap break-words/);
    assert.match(hook, /shouldBlockManualRecompare/);
    assert.match(hook, /manualRecompareInFlightRef/);
    assert.match(hook, /areKnowledgeComparisonsSemanticallyEqual/);
    assert.match(hook, /setLastComparedAt/);
    assert.match(zhHant, /正在重新比對/);
    assert.match(zhHant, /比對結果已更新/);
    assert.match(zhHant, /目前結果已是最新狀態，暫無新的變化。/);
    assert.match(zhHans, /正在重新比对/);
    assert.match(zhHans, /比对结果已更新/);
    assert.match(en, /Recomparing/);
    assert.match(en, /Comparison result updated/);
  });
});
