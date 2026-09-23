import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHASE_PRIVATE_CLIENT_FIXTURE_TEXT } from "@/lib/knowledge/knowledge-evidence-grounding";
import {
  assessKnowledgeDuplicateResolution,
  buildDuplicateNoticeFromSource,
} from "@/lib/knowledge/source-duplicate-resolution";
import {
  buildVisionExtractionMetadata,
  parseVisionExtractionMetadata,
  serializeVisionExtractionMetadata,
} from "@/lib/knowledge/vision-extraction-metadata";
import {
  applyVisionIntegrityToMetadata,
  assessVisionExtractionIntegrity,
} from "@/lib/knowledge/knowledge-vision-integrity";

function chaseSource(overrides: Record<string, unknown> = {}) {
  const metadata = buildVisionExtractionMetadata({
    quality: "medium",
    warnings: [],
  });
  const integrity = assessVisionExtractionIntegrity({
    rawText: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
    extractionMetadata: metadata,
    extractionMethod: "vision",
    extractionModel: "mock-knowledge-vision-v1",
  });
  const applied = applyVisionIntegrityToMetadata(metadata, integrity);
  return {
    id: "source-1",
    sourceTitle: null,
    originalFilename: "IMG_6838.png",
    status: "ready" as const,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    sourceType: "file",
    storageKey: "knowledge/sources/test",
    extractionMethod: "vision",
    extractionMetadataJson: serializeVisionExtractionMetadata(applied),
    rawText: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
    linkedArticleId: null,
    ...overrides,
  };
}

describe("knowledge duplicate reprocess resolution", () => {
  it("A: unusable duplicate offers reprocess", () => {
    const metadata = buildVisionExtractionMetadata({
      quality: "low",
      warnings: [{ code: "EXTRACTION_UNUSABLE", message: "test" }],
    });
    const applied = applyVisionIntegrityToMetadata(
      {
        ...metadata,
        integrityTrace: {
          extractionModel: "mock",
          modelReportedQuality: "low",
          effectiveQuality: "low",
          requiresHumanReview: true,
          extractionUsable: false,
          reasons: ["EXTRACTION_UNUSABLE"],
          highRiskFacts: [],
        },
      },
      {
        ok: false,
        unsupportedTerms: [],
        requiresHumanReview: true,
        reason: "insufficient_extraction",
        integrityTrace: metadata.integrityTrace ?? null,
      },
    );
    const resolution = assessKnowledgeDuplicateResolution({
      ...chaseSource({
        rawText: "",
        extractionMetadataJson: serializeVisionExtractionMetadata(applied),
      }),
    });
    assert.equal(resolution.case, "unusable");
    assert.equal(resolution.canReprocess, true);
  });

  it("B: awaiting-review duplicate offers continue and reprocess", () => {
    const resolution = assessKnowledgeDuplicateResolution(chaseSource());
    assert.equal(resolution.case, "awaiting_review");
    assert.equal(resolution.canContinueReview, true);
    assert.equal(resolution.canReprocess, true);
  });

  it("C: completed duplicate defaults to view with optional confirmed reprocess", () => {
    const metadata = parseConfirmedMetadata();
    const resolution = assessKnowledgeDuplicateResolution(
      chaseSource({
        status: "organized",
        extractionMetadataJson: metadata,
      }),
    );
    assert.equal(resolution.case, "completed");
    assert.equal(resolution.canReprocess, true);
    assert.equal(resolution.requiresReprocessConfirmation, true);
    assert.equal(resolution.canContinueReview, false);
  });

  it("H: published converted source cannot be reprocessed", () => {
    const resolution = assessKnowledgeDuplicateResolution(
      chaseSource({
        status: "converted",
        linkedArticleId: "article-1",
      }),
    );
    assert.equal(resolution.canReprocess, false);
  });

  it("duplicate notice includes resolution fields", () => {
    const notice = buildDuplicateNoticeFromSource(chaseSource());
    assert.equal(notice.canReprocess, true);
    assert.equal(notice.case, "awaiting_review");
  });

  it("F: confirmed metadata must be cleared on reprocess success payload", () => {
    const confirmed = parseVisionExtractionMetadata(parseConfirmedMetadata())!;
    assert.ok(confirmed?.humanReviewConfirmedAt);
    const cleared = {
      ...confirmed,
      humanReviewConfirmedAt: null,
      humanReviewConfirmedByUserId: null,
      humanEvidenceManuallySupplied: false,
    };
    assert.equal(cleared.humanReviewConfirmedAt, null);
    assert.equal(cleared.humanEvidenceManuallySupplied, false);
  });
});

function parseConfirmedMetadata(): string {
  const metadata = buildVisionExtractionMetadata({
    quality: "medium",
    warnings: [],
  });
  const integrity = assessVisionExtractionIntegrity({
    rawText: CHASE_PRIVATE_CLIENT_FIXTURE_TEXT,
    extractionMetadata: metadata,
    extractionMethod: "vision",
    extractionModel: "mock-knowledge-vision-v1",
  });
  const applied = applyVisionIntegrityToMetadata(metadata, integrity);
  return serializeVisionExtractionMetadata({
    ...applied,
    humanReviewConfirmedAt: "2026-01-02T00:00:00.000Z",
    humanReviewConfirmedByUserId: "user-1",
  });
}
