import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOrganizerDraftFromOrganization,
  resolveOrganizerKnowledgeCategoryId,
  resolveOrganizerRequestedProjectCode,
} from "@/lib/knowledge/knowledge-ingest-organizer-draft";
import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";

function sourceWithIdentity(
  identity: NonNullable<KnowledgeSourceDetail["organization"]>["businessIdentity"],
): KnowledgeSourceDetail {
  return {
    id: "src-1",
    sourceType: "paste",
    sourceTitle: null,
    originalFilename: null,
    mimeType: null,
    sizeBytes: 10,
    status: "organized",
    analysisStatus: "none",
    failureCode: null,
    linkedArticleId: null,
    createdByUserId: "u1",
    archivedAt: null,
    archivedByUserId: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    processedAt: null,
    rawText: "x",
    storageKey: null,
    contentHash: "hash",
    extractionMethod: null,
    extractionModel: null,
    extractionMetadata: null,
    pageCount: null,
    smartIngestScope: {
      analysisStatus: "none",
      latestAnalysisRunId: null,
      segments: [],
      unconfirmedProposedCount: 0,
      confirmedSegmentCount: 0,
      rejectedSegmentCount: 0,
      retainedProposedSegmentCount: 0,
      activeSegmentCount: 0,
      blocksSourceLevelOrganize: false,
      blocksSourceLevelComparison: false,
      singleSegmentId: null,
      singleSegmentEvidenceText: null,
    },
    organization: {
      id: "run-1",
      status: "completed",
      provider: "mock",
      model: "mock",
      proposedTitle: "Chase Private Client",
      proposedSummary: "s",
      proposedBody: "body",
      proposedCategory: "美国银行账户",
      businessIdentity: identity,
      warnings: [],
      failureCode: null,
      createdAt: "2026-01-01",
      completedAt: "2026-01-01",
    },
  };
}

const chaseIdentity = {
  title: "Chase Private Client",
  countryGroupCode: "united_states" as const,
  countryLabelZhHans: "美国",
  requestedProjectCode: "us_bank_account",
  categoryMatch: "confident" as const,
  signal: "chase_us_banking" as const,
  confidence: 5,
  identityConsistent: true,
};

describe("knowledge ingest organizer draft", () => {
  it("E: manual CRM business override does not modify Knowledge category", () => {
    const code = resolveOrganizerRequestedProjectCode({
      identity: chaseIdentity,
      manualCode: "hk_bank_account",
      manualOverride: true,
    });
    assert.equal(code, "hk_bank_account");
    assert.equal(
      resolveOrganizerKnowledgeCategoryId({
        manualCategoryId: "cat-sop",
        manualCategoryOverride: true,
      }),
      "cat-sop",
    );
  });

  it("C: matching Knowledge category name does not auto-select categoryId", () => {
    const draft = buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
    );
    assert.equal(draft.requestedProjectCode, "us_bank_account");
    assert.equal(draft.categoryId, "");
  });

  it("D: manual Knowledge category preserved when applying organization", () => {
    const draft = buildOrganizerDraftFromOrganization(
      sourceWithIdentity({
        ...chaseIdentity,
        requestedProjectCode: "hk_bank_account",
        signal: "hsbc_hk_banking",
        title: "香港汇丰银行账户",
      }),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: "cat-sop",
        manualCategoryOverride: true,
      },
    );
    assert.equal(draft.requestedProjectCode, "hk_bank_account");
    assert.equal(draft.categoryId, "cat-sop");
  });

  it("H: no-match CRM identity does not invent Knowledge category", () => {
    const draft = buildOrganizerDraftFromOrganization(
      sourceWithIdentity({
        title: "Unknown",
        countryGroupCode: "other",
        countryLabelZhHans: "其他",
        requestedProjectCode: null,
        categoryMatch: "no_match",
        signal: "unknown",
        confidence: 0,
        identityConsistent: true,
      }),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
    );
    assert.equal(draft.requestedProjectCode, null);
    assert.equal(draft.categoryId, "");
    assert.equal(draft.categoryNotice, "no_match");
  });
});
