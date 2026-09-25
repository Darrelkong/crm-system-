import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildOrganizerDraftFromOrganization } from "@/lib/knowledge/knowledge-ingest-organizer-draft";
import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";

const root = process.cwd();
const ingestPath = join(root, "src/components/knowledge/knowledge-ingest-client.tsx");
const draftPath = join(
  root,
  "src/lib/knowledge/knowledge-ingest-organizer-draft.ts",
);

function minimalSource(): KnowledgeSourceDetail {
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
      proposedTitle: "Title",
      proposedSummary: "Summary",
      proposedBody: "Body",
      proposedCategory: null,
      businessIdentity: {
        title: "HK",
        countryGroupCode: "hong_kong",
        countryLabelZhHans: "香港",
        requestedProjectCode: null,
        categoryMatch: "no_match",
        signal: "hsbc_hk_banking",
        confidence: 5,
        identityConsistent: true,
      },
      warnings: [],
      failureCode: null,
      createdAt: "2026-01-01",
      completedAt: "2026-01-01",
    },
  };
}

describe("knowledge ingest category UI state contract", () => {
  it("A/B: high AI draft exposes ai_suggestion with authoritative categoryId", async () => {
    const draft = await buildOrganizerDraftFromOrganization(
      minimalSource(),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      undefined,
      {
        suggestCategory: async () => ({
          status: "suggested",
          categoryId: "11111111-1111-4111-8111-111111111101",
          categoryName: "Preview Cat",
          resolutionSource: "ai_suggestion",
          requiresConfirmation: false,
        }),
      },
    );
    assert.equal(draft.categoryId, "11111111-1111-4111-8111-111111111101");
    assert.equal(draft.categoryResolutionSource, "ai_suggestion");
    assert.equal(draft.categoryAiRequiresConfirmation, false);
  });

  it("B/C: medium AI draft keeps categoryId empty with suggestedCategoryId", async () => {
    const draft = await buildOrganizerDraftFromOrganization(
      minimalSource(),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      undefined,
      {
        suggestCategory: async () => ({
          status: "suggested",
          categoryId: "22222222-2222-4222-8222-222222222202",
          categoryName: "Preview Cat",
          resolutionSource: "ai_suggestion",
          requiresConfirmation: true,
        }),
      },
    );
    assert.equal(draft.categoryId, "");
    assert.equal(draft.suggestedCategoryId, "22222222-2222-4222-8222-222222222202");
    assert.equal(draft.categoryAiRequiresConfirmation, true);
  });

  it("G: low/unresolved draft exposes selection required without suggestion", async () => {
    const draft = await buildOrganizerDraftFromOrganization(
      minimalSource(),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      undefined,
      {
        suggestCategory: async () => ({
          status: "insufficient_confidence",
          resolutionSource: null,
          requiresConfirmation: false,
        }),
      },
    );
    assert.equal(draft.categoryId, "");
    assert.equal(draft.suggestedCategoryId, null);
    assert.equal(draft.categorySelectionRequired, true);
  });

  it("J/K: ingest client renders AI, adopt, and explicit mapping badges", () => {
    const ingest = readFileSync(ingestPath, "utf8");
    assert.match(ingest, /data-category-state-badge="ai_suggestion"/);
    assert.match(ingest, /data-category-state-badge="explicit_mapping"/);
    assert.match(ingest, /data-category-state-badge="selection_required"/);
    assert.match(ingest, /data-adopt-category-suggestion="true"/);
    assert.match(ingest, /categoryAutoMatched/);
    assert.doesNotMatch(
      ingest,
      /categoryResolutionSource === "explicit_mapping"[\s\S]{0,120}categoryAiSuggested/,
    );
  });

  it("draft contract exposes suggestedCategoryId and confirmation flags", () => {
    const draftSource = readFileSync(draftPath, "utf8");
    assert.match(draftSource, /suggestedCategoryId/);
    assert.match(draftSource, /categoryAiRequiresConfirmation/);
  });

  it("L: organizer warnings deduplicated at UI boundary", () => {
    const ingest = readFileSync(ingestPath, "utf8");
    assert.match(ingest, /new Set\(selected\?\.organization\?\.warnings/);
  });
});
