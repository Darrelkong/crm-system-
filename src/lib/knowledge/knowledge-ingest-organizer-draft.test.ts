import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOrganizerDraftFromOrganization,
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

describe("knowledge ingest organizer draft", () => {
  it("H: manual requested project override is preserved", () => {
    const code = resolveOrganizerRequestedProjectCode({
      identity: {
        title: "Chase Private Client",
        countryGroupCode: "united_states",
        countryLabelZhHans: "美国",
        requestedProjectCode: "us_bank_account",
        categoryMatch: "confident",
        signal: "chase_us_banking",
        confidence: 5,
        identityConsistent: true,
      },
      manualCode: "hk_bank_account",
      manualOverride: true,
    });
    assert.equal(code, "hk_bank_account");
  });

  it("F: confident identity auto-selects mapped knowledge category id", () => {
    const draft = buildOrganizerDraftFromOrganization(
      sourceWithIdentity({
        title: "Chase Private Client",
        countryGroupCode: "united_states",
        countryLabelZhHans: "美国",
        requestedProjectCode: "us_bank_account",
        categoryMatch: "confident",
        signal: "chase_us_banking",
        confidence: 5,
        identityConsistent: true,
      }),
      [{ id: "cat-us", name: "美国银行账户", isActive: true }],
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
    );
    assert.equal(draft.requestedProjectCode, "us_bank_account");
    assert.equal(draft.categoryId, "cat-us");
  });
});
