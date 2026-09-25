import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { createKnowledgeCategory } from "@/lib/knowledge/core-service";
import {
  createBusinessCategoryMapping,
  getMappingByRequestedProjectCode,
} from "@/lib/knowledge/knowledge-business-category-mapping-service";
import {
  buildOrganizerDraftFromOrganization,
  type OrganizerDraftBuildDeps,
} from "@/lib/knowledge/knowledge-ingest-organizer-draft";
import type { KnowledgeCategoryAiSuggestionResult } from "@/lib/knowledge/knowledge-category-ai-suggestion-schema";
import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";

const META = { ipAddress: null, userAgent: "knowledge-category-ai-2c" };

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;

const adminContext = () => ({
  user: adminUser,
  sessionId: "category-ai-2c-admin",
  role: "knowledge_admin" as const,
});

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

function sourceWithIdentity(
  identity: NonNullable<KnowledgeSourceDetail["organization"]>["businessIdentity"],
  body = "body",
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
      proposedBody: body,
      proposedCategory: "美国银行账户",
      businessIdentity: identity,
      warnings: [],
      failureCode: null,
      createdAt: "2026-01-01",
      completedAt: "2026-01-01",
    },
  };
}

function suggestStub(
  result: KnowledgeCategoryAiSuggestionResult,
): OrganizerDraftBuildDeps {
  return { suggestCategory: async () => result };
}

async function cleanup(): Promise<void> {
  await db.delete(schema.knowledgeBusinessCategoryMappings);
  await db.delete(schema.knowledgeArticleVersions);
  await db.delete(schema.knowledgeArticles);
  await db.delete(schema.knowledgeCategories);
}

describe("knowledge category AI fallback (2C)", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    adminUser = (
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, SEED_IDS.admin))
        .limit(1)
    )[0] as User;
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("A: manual category prevents AI override", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "AI Cat", description: null, sortOrder: 1 },
      META,
      db,
    );
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity({
        ...chaseIdentity,
        requestedProjectCode: "hk_bank_account",
        signal: "hsbc_hk_banking",
      }),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: "cat-manual",
        manualCategoryOverride: true,
      },
      db,
      suggestStub({
        status: "suggested",
        categoryId: category.id,
        categoryName: category.name,
        resolutionSource: "ai_suggestion",
        requiresConfirmation: false,
      }),
    );
    assert.equal(draft.categoryId, "cat-manual");
    assert.equal(draft.categoryResolutionSource, "manual");
  });

  it("B: explicit mapping wins and AI stub must not be used", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Mapped", description: null, sortOrder: 1 },
      META,
      db,
    );
    await createBusinessCategoryMapping(
      {
        requestedProjectCode: "us_bank_account",
        knowledgeCategoryId: category.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    let aiCalled = false;
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
      {
        suggestCategory: async () => {
          aiCalled = true;
          return {
            status: "suggested",
            categoryId: "should-not-use",
            categoryName: "x",
            resolutionSource: "ai_suggestion",
            requiresConfirmation: false,
          };
        },
      },
    );
    assert.equal(aiCalled, false);
    assert.equal(draft.categoryId, category.id);
    assert.equal(draft.categoryResolutionSource, "explicit_mapping");
  });

  it("C: high-confidence AI prefill when unmapped", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "HK Preview", description: null, sortOrder: 1 },
      META,
      db,
    );
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity({
        ...chaseIdentity,
        requestedProjectCode: "hk_bank_account",
        signal: "hsbc_hk_banking",
      }),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
      suggestStub({
        status: "suggested",
        categoryId: category.id,
        categoryName: category.name,
        resolutionSource: "ai_suggestion",
        requiresConfirmation: false,
      }),
    );
    assert.equal(draft.categoryId, category.id);
    assert.equal(draft.categoryResolutionSource, "ai_suggestion");
  });

  it("G: medium confidence requires confirmation before categoryId is set", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "HK Preview", description: null, sortOrder: 1 },
      META,
      db,
    );
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity({
        ...chaseIdentity,
        requestedProjectCode: "hk_bank_account",
      }),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
      suggestStub({
        status: "suggested",
        categoryId: category.id,
        categoryName: category.name,
        resolutionSource: "ai_suggestion",
        requiresConfirmation: true,
      }),
    );
    assert.equal(draft.categoryId, "");
    assert.equal(draft.categoryAiSuggestion?.categoryId, category.id);
    assert.equal(draft.categorySelectionRequired, true);
  });

  it("H: AI error leaves organizer draft usable", async () => {
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity({
        ...chaseIdentity,
        requestedProjectCode: "hk_bank_account",
      }),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
      suggestStub({
        status: "error",
        resolutionSource: null,
        requiresConfirmation: false,
      }),
    );
    assert.equal(draft.title, "Chase Private Client");
    assert.equal(draft.categoryId, "");
    assert.equal(draft.categorySelectionRequired, true);
  });

  it("J: AI suggestion does not create mapping row", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "HK Preview", description: null, sortOrder: 1 },
      META,
      db,
    );
    await buildOrganizerDraftFromOrganization(
      sourceWithIdentity({
        ...chaseIdentity,
        requestedProjectCode: "hk_bank_account",
      }),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
      suggestStub({
        status: "suggested",
        categoryId: category.id,
        categoryName: category.name,
        resolutionSource: "ai_suggestion",
        requiresConfirmation: false,
      }),
    );
    const mapping = await getMappingByRequestedProjectCode("hk_bank_account", db);
    assert.equal(mapping, null);
  });

  it("N: stale auto category cleared when new resolution fails", async () => {
    const usCategory = await createKnowledgeCategory(
      adminContext(),
      { name: "US", description: null, sortOrder: 1 },
      META,
      db,
    );
    await createBusinessCategoryMapping(
      {
        requestedProjectCode: "us_bank_account",
        knowledgeCategoryId: usCategory.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    const mapped = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
    );
    assert.equal(mapped.categoryId, usCategory.id);
    const failed = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: "hk_bank_account",
        manualRequestedProjectOverride: true,
        manualCategoryId: mapped.categoryId,
        manualCategoryOverride: false,
      },
      db,
      suggestStub({
        status: "insufficient_confidence",
        resolutionSource: null,
        requiresConfirmation: false,
      }),
    );
    assert.equal(failed.categoryId, "");
  });

  it("P: multi-topic source-level organizer still blocked", async () => {
    const draft = await buildOrganizerDraftFromOrganization(
      {
        ...sourceWithIdentity(chaseIdentity),
        smartIngestScope: {
          ...sourceWithIdentity(chaseIdentity).smartIngestScope,
          activeSegmentCount: 2,
          blocksSourceLevelOrganize: true,
          blocksSourceLevelComparison: true,
        },
      },
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
      suggestStub({
        status: "suggested",
        categoryId: "x",
        categoryName: "x",
        resolutionSource: "ai_suggestion",
        requiresConfirmation: false,
      }),
    );
    assert.equal(draft.title, "");
  });
});
