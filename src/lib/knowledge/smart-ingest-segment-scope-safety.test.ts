import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  assertSourceLevelOrganizeAllowed,
  countRetainedProposedSegments,
  deriveSmartIngestSourceScope,
  resolveOrganizerEvidenceText,
} from "@/lib/knowledge/smart-ingest-source-scope";

describe("smart ingest segment scope safety", () => {
  it("G: rejected and superseded segments are not retained", () => {
    const segments = [
      {
        id: "a",
        segmentIndex: 0,
        titleHint: "A",
        evidenceText: "A",
        evidenceStart: 0,
        evidenceEnd: 1,
        status: "proposed" as const,
      },
      {
        id: "b",
        segmentIndex: 1,
        titleHint: "B",
        evidenceText: "B",
        evidenceStart: 1,
        evidenceEnd: 2,
        status: "rejected" as const,
      },
      {
        id: "c",
        segmentIndex: 2,
        titleHint: "C",
        evidenceText: "C",
        evidenceStart: 2,
        evidenceEnd: 3,
        status: "superseded" as const,
      },
    ];
    assert.equal(countRetainedProposedSegments(segments), 1);
    const scope = deriveSmartIngestSourceScope({
      analysisStatus: "ready_for_review",
      latestAnalysisRunId: "run-1",
      segments,
    });
    assert.equal(scope.retainedProposedSegmentCount, 1);
    assert.equal(scope.blocksSourceLevelOrganize, false);
  });

  it("A/C: three retained proposed segments block source-level organize", () => {
    const scope = deriveSmartIngestSourceScope({
      analysisStatus: "ready_for_review",
      latestAnalysisRunId: "run-1",
      segments: [
        {
          id: "1",
          segmentIndex: 0,
          titleHint: "HSBC",
          evidenceText: "HSBC",
          evidenceStart: 0,
          evidenceEnd: 4,
          status: "proposed",
        },
        {
          id: "2",
          segmentIndex: 1,
          titleHint: "BOC",
          evidenceText: "BOC",
          evidenceStart: 5,
          evidenceEnd: 8,
          status: "proposed",
        },
        {
          id: "3",
          segmentIndex: 2,
          titleHint: "Chase",
          evidenceText: "Chase",
          evidenceStart: 9,
          evidenceEnd: 14,
          status: "proposed",
        },
      ],
    });
    assert.equal(scope.retainedProposedSegmentCount, 3);
    assert.equal(scope.blocksSourceLevelOrganize, true);
    assert.equal(scope.blocksSourceLevelComparison, true);
    assert.throws(
      () => assertSourceLevelOrganizeAllowed(scope),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(
          error.errorCode,
          KNOWLEDGE_ERROR_CODES.SMART_INGEST_SEGMENT_SCOPE_REQUIRED,
        );
        return true;
      },
    );
  });

  it("F: single retained segment uses segment evidence for organizer input", () => {
    const scope = deriveSmartIngestSourceScope({
      analysisStatus: "ready_for_review",
      latestAnalysisRunId: "run-1",
      segments: [
        {
          id: "only",
          segmentIndex: 0,
          titleHint: "Chase",
          evidenceText: "Chase Private Client only",
          evidenceStart: 0,
          evidenceEnd: 24,
          status: "proposed",
        },
      ],
    });
    assert.equal(scope.blocksSourceLevelOrganize, false);
    assert.equal(
      resolveOrganizerEvidenceText("full mixed source text", scope),
      "Chase Private Client only",
    );
  });

  it("legacy paste without analysis uses full source text", () => {
    const scope = deriveSmartIngestSourceScope({
      analysisStatus: "none",
      latestAnalysisRunId: null,
      segments: [],
    });
    assert.equal(
      resolveOrganizerEvidenceText("legacy paste body", scope),
      "legacy paste body",
    );
  });
});
