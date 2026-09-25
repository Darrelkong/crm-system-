import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";
import {
  buildCandidateLineageKey,
  confirmedSegmentCountFromScope,
  resolveStableAnalysisRunId,
  shouldResetCandidateLineage,
} from "@/lib/knowledge/knowledge-smart-ingest-candidate-lineage";

const sourceScope = (
  runId: string | null,
  segments: { status: string }[],
): Pick<KnowledgeSourceDetail, "smartIngestScope"> => ({
    smartIngestScope: {
      latestAnalysisRunId: runId,
      segments: segments.map((segment, index) => ({
        id: `seg-${index}`,
        segmentIndex: index,
        titleHint: `Topic ${index}`,
        evidenceText: "evidence",
        evidenceStart: 0,
        evidenceEnd: 1,
        status: segment.status as "proposed" | "confirmed" | "rejected" | "superseded",
      })),
      analysisStatus: "ready_for_review",
      unconfirmedProposedCount: 0,
      confirmedSegmentCount: segments.filter((s) => s.status === "confirmed")
        .length,
      rejectedSegmentCount: 0,
      retainedProposedSegmentCount: 0,
      activeSegmentCount: segments.length,
      blocksSourceLevelOrganize: true,
      blocksSourceLevelComparison: true,
      singleSegmentId: null,
      singleSegmentEvidenceText: null,
    },
  });

describe("knowledge smart ingest candidate lineage (2E-4C)", () => {
  it("resolves stable run id from completed run or source scope fallback", () => {
    const source = sourceScope("run-a", [{ status: "confirmed" }]);
    assert.equal(
      resolveStableAnalysisRunId(source, {
        id: "run-a",
        status: "completed",
        segments: [{ status: "confirmed" }],
      }),
      "run-a",
    );
    assert.equal(
      resolveStableAnalysisRunId(source, {
        id: "run-pending",
        status: "processing",
        segments: [],
      }),
      "run-a",
    );
    assert.equal(resolveStableAnalysisRunId(source, null), "run-a");
  });

  it("does not treat transient null run as lineage loss", () => {
    const keyA = buildCandidateLineageKey("source-1", "run-a");
    assert.equal(shouldResetCandidateLineage(keyA, keyA), false);
    assert.equal(
      shouldResetCandidateLineage(
        keyA,
        buildCandidateLineageKey("source-1", "run-a"),
      ),
      false,
    );
  });

  it("resets only on real source/run lineage change", () => {
    const keyA = buildCandidateLineageKey("source-1", "run-a");
    const keyB = buildCandidateLineageKey("source-1", "run-b");
    assert.equal(shouldResetCandidateLineage(null, keyA), false);
    assert.equal(shouldResetCandidateLineage(keyA, keyB), true);
    assert.equal(
      shouldResetCandidateLineage(
        keyA,
        buildCandidateLineageKey("source-2", "run-a"),
      ),
      true,
    );
  });

  it("counts confirmed segments from completed run or source scope", () => {
    const source = sourceScope("run-a", [
      { status: "confirmed" },
      { status: "proposed" },
    ]);
    assert.equal(
      confirmedSegmentCountFromScope(source, {
        id: "run-a",
        status: "completed",
        segments: [
          { status: "confirmed" },
          { status: "proposed" },
          { status: "rejected" },
        ],
      }),
      1,
    );
    assert.equal(
      confirmedSegmentCountFromScope(source, {
        id: "run-a",
        status: "processing",
        segments: [],
      }),
      1,
    );
  });
});
