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
  deactivateBusinessCategoryMapping,
} from "@/lib/knowledge/knowledge-business-category-mapping-service";
import {
  buildOrganizerDraftFromOrganization,
  resolveOrganizerKnowledgeCategoryId,
} from "@/lib/knowledge/knowledge-ingest-organizer-draft";
import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";

const META = { ipAddress: null, userAgent: "knowledge-category-autofill-2b" };

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;

const adminContext = () => ({
  user: adminUser,
  sessionId: "category-autofill-admin-session",
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
  scope?: Partial<KnowledgeSourceDetail["smartIngestScope"]>,
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
      activeSegmentCount: scope?.activeSegmentCount ?? 0,
      blocksSourceLevelOrganize: scope?.blocksSourceLevelOrganize ?? false,
      blocksSourceLevelComparison: scope?.blocksSourceLevelComparison ?? false,
      singleSegmentId: null,
      singleSegmentEvidenceText: null,
      ...scope,
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

async function cleanup(): Promise<void> {
  await db.delete(schema.knowledgeBusinessCategoryMappings);
  await db.delete(schema.knowledgeArticleVersions);
  await db.delete(schema.knowledgeArticles);
  await db.delete(schema.knowledgeCategories);
}

describe("knowledge ingest category autofill (2B)", () => {
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

  it("A: manual Knowledge category override preserved over explicit mapping", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "美国银行账户", description: null, sortOrder: 1 },
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
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: "cat-manual",
        manualCategoryOverride: true,
      },
      db,
    );
    assert.equal(draft.categoryId, "cat-manual");
    assert.equal(draft.categoryResolutionSource, "manual");
  });

  it("B: valid explicit mapping auto-fills category", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "美国银行账户", description: null, sortOrder: 1 },
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
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
    );
    assert.equal(draft.categoryId, category.id);
    assert.equal(draft.categoryResolutionSource, "explicit_mapping");
    assert.equal(draft.categoryResolutionStatus, "matched");
  });

  it("C: no mapping leaves category unresolved", async () => {
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
    );
    assert.equal(draft.categoryId, "");
    assert.equal(draft.categoryResolutionSource, null);
    assert.equal(draft.categoryResolutionStatus, "unmapped");
  });

  it("D: inactive mapping leaves category unresolved", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "美国银行账户", description: null, sortOrder: 1 },
      META,
      db,
    );
    const mapping = await createBusinessCategoryMapping(
      {
        requestedProjectCode: "us_bank_account",
        knowledgeCategoryId: category.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    await deactivateBusinessCategoryMapping(mapping.id, adminUser.id, db);
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
    );
    assert.equal(draft.categoryId, "");
    assert.equal(draft.categoryResolutionStatus, "inactive_mapping");
  });

  it("E: inactive target category leaves category unresolved", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "美国银行账户", description: null, sortOrder: 1 },
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
    await db
      .update(schema.knowledgeCategories)
      .set({ isActive: false })
      .where(eq(schema.knowledgeCategories.id, category.id));
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
    );
    assert.equal(draft.categoryId, "");
    assert.equal(draft.categoryResolutionStatus, "inactive_category");
  });

  it("F: invalid business code resolves safely", async () => {
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: "not_a_real_business_code",
        manualRequestedProjectOverride: true,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
    );
    assert.equal(draft.categoryId, "");
    assert.equal(draft.categoryResolutionStatus, "invalid_business");
  });

  it("G: matching label without mapping row does not auto-fill", async () => {
    await createKnowledgeCategory(
      adminContext(),
      { name: "美国银行账户", description: null, sortOrder: 1 },
      META,
      db,
    );
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
    );
    assert.equal(draft.categoryId, "");
    assert.equal(draft.categoryResolutionSource, null);
  });

  it("H: manual Related Business change re-resolves when category is auto-controlled", async () => {
    const usCategory = await createKnowledgeCategory(
      adminContext(),
      { name: "美国银行账户", description: null, sortOrder: 1 },
      META,
      db,
    );
    const hkCategory = await createKnowledgeCategory(
      adminContext(),
      { name: "香港银行账户", description: null, sortOrder: 2 },
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
    await createBusinessCategoryMapping(
      {
        requestedProjectCode: "hk_bank_account",
        knowledgeCategoryId: hkCategory.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: "hk_bank_account",
        manualRequestedProjectOverride: true,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
    );
    assert.equal(draft.requestedProjectCode, "hk_bank_account");
    assert.equal(draft.categoryId, hkCategory.id);
    assert.equal(draft.categoryResolutionSource, "explicit_mapping");
  });

  it("I: manual Related Business change does not overwrite manual Knowledge Category", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "美国银行账户", description: null, sortOrder: 1 },
      META,
      db,
    );
    await createBusinessCategoryMapping(
      {
        requestedProjectCode: "hk_bank_account",
        knowledgeCategoryId: category.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: "hk_bank_account",
        manualRequestedProjectOverride: true,
        manualCategoryId: "cat-manual",
        manualCategoryOverride: true,
      },
      db,
    );
    assert.equal(draft.categoryId, "cat-manual");
    assert.equal(draft.categoryResolutionSource, "manual");
  });

  it("J: stale auto category cleared when business changes to unmapped code", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "美国银行账户", description: null, sortOrder: 1 },
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
    assert.equal(mapped.categoryId, category.id);
    const unmapped = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: "hk_bank_account",
        manualRequestedProjectOverride: true,
        manualCategoryId: mapped.categoryId,
        manualCategoryOverride: false,
      },
      db,
    );
    assert.equal(unmapped.categoryId, "");
    assert.equal(unmapped.categoryResolutionStatus, "unmapped");
  });

  it("K: re-organize preserves manual category", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "美国银行账户", description: null, sortOrder: 1 },
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
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: "cat-manual",
        manualCategoryOverride: true,
      },
      db,
    );
    assert.equal(draft.categoryId, "cat-manual");
  });

  it("L: re-organize can refresh explicit auto mapping", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "美国银行账户", description: null, sortOrder: 1 },
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
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: "",
        manualCategoryOverride: false,
      },
      db,
    );
    assert.equal(draft.categoryId, category.id);
    assert.equal(draft.categoryResolutionSource, "explicit_mapping");
  });

  it("M: draft save path accepts auto-filled category id", () => {
    const categoryId = resolveOrganizerKnowledgeCategoryId({
      manualCategoryId: null,
      manualCategoryOverride: false,
      explicitMappingCategoryId: "cat-auto",
    });
    assert.equal(categoryId, "cat-auto");
    assert.ok(categoryId.length > 0);
  });

  it("N: unresolved category blocks draft save client-side", () => {
    const categoryId = resolveOrganizerKnowledgeCategoryId({
      manualCategoryId: null,
      manualCategoryOverride: false,
      explicitMappingCategoryId: null,
    });
    assert.equal(categoryId, "");
  });

  it("O: multi-topic source-level organizer draft stays empty", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "美国银行账户", description: null, sortOrder: 1 },
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
    const draft = await buildOrganizerDraftFromOrganization(
      sourceWithIdentity(chaseIdentity, {
        activeSegmentCount: 2,
        blocksSourceLevelOrganize: true,
        blocksSourceLevelComparison: true,
      }),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
    );
    assert.equal(draft.categoryId, "");
    assert.equal(draft.title, "");
  });

  it("P: resolver uses explicit mapping only (no AI in draft builder)", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const draftPath = fileURLToPath(
      new URL("./knowledge-ingest-organizer-draft.ts", import.meta.url),
    );
    const source = await readFile(draftPath, "utf8");
    assert.match(source, /resolveKnowledgeCategoryForBusiness/);
    assert.doesNotMatch(source, /organizeKnowledge|ai-organizer-service|openai|gemma/i);
  });
});
