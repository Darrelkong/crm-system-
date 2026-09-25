import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { REQUESTED_PROJECT_ITEMS } from "@/lib/constants/requested-projects";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { createKnowledgeCategory } from "@/lib/knowledge/core-service";
import {
  createBusinessCategoryMapping,
  deactivateBusinessCategoryMapping,
  resolveKnowledgeCategoryForBusiness,
} from "@/lib/knowledge/knowledge-business-category-mapping-service";
import {
  createBusinessCategoryMappingAsAdmin,
  listBusinessCategoryMappingAdminRows,
  updateBusinessCategoryMappingAsAdmin,
} from "@/lib/knowledge/knowledge-business-category-mapping-admin-service";
import { buildOrganizerDraftFromOrganization } from "@/lib/knowledge/knowledge-ingest-organizer-draft";
import type { KnowledgeSourceDetail } from "@/lib/knowledge/source-service";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";

const META = { ipAddress: null, userAgent: "knowledge-mapping-2d-admin-test" };
const root = process.cwd();

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;

const adminContext = () => ({
  user: adminUser,
  sessionId: "mapping-2d-admin-session",
  role: "knowledge_admin" as const,
});

async function cleanup(): Promise<void> {
  await db.delete(schema.knowledgeBusinessCategoryMappings);
  await db.delete(schema.knowledgeArticleVersions);
  await db.delete(schema.knowledgeArticles);
  await db.delete(schema.knowledgeCategories);
}

function minimalSource(identity: KnowledgeSourceDetail["organization"]): KnowledgeSourceDetail {
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
    organization: identity,
  };
}

describe("knowledge business category mapping admin (2D)", () => {
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

  it("A/M: knowledge_admin list includes canonical CRM businesses", async () => {
    const rows = await listBusinessCategoryMappingAdminRows("zh-Hans", db);
    assert.equal(rows.length, REQUESTED_PROJECT_ITEMS.length);
    const hk = rows.find((row) => row.requestedProjectCode === "hk_bank_account");
    assert.ok(hk);
    assert.equal(hk?.status, "unmapped");
    assert.match(hk?.requestedProjectLabel ?? "", /香港/);
  });

  it("E: create mapping succeeds with audit created_by", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "P2C-A2 Preview", description: null, sortOrder: 1 },
      META,
      db,
    );
    const mapping = await createBusinessCategoryMappingAsAdmin(
      {
        requestedProjectCode: "hk_bank_account",
        knowledgeCategoryId: category.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    assert.equal(mapping.requestedProjectCode, "hk_bank_account");
    assert.equal(mapping.createdByUserId, adminUser.id);
    assert.equal(mapping.updatedByUserId, adminUser.id);
  });

  it("F: duplicate active business mapping rejected", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Cat A", description: null, sortOrder: 1 },
      META,
      db,
    );
    await createBusinessCategoryMappingAsAdmin(
      {
        requestedProjectCode: "hk_bank_account",
        knowledgeCategoryId: category.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    const categoryB = await createKnowledgeCategory(
      adminContext(),
      { name: "Cat B", description: null, sortOrder: 2 },
      META,
      db,
    );
    await assert.rejects(
      () =>
        createBusinessCategoryMappingAsAdmin(
          {
            requestedProjectCode: "hk_bank_account",
            knowledgeCategoryId: categoryB.id,
            actorUserId: adminUser.id,
          },
          db,
        ),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.httpStatus, 409);
        return true;
      },
    );
  });

  it("G/K: update mapping changes category with updated_by audit", async () => {
    const catA = await createKnowledgeCategory(
      adminContext(),
      { name: "Cat A", description: null, sortOrder: 1 },
      META,
      db,
    );
    const catB = await createKnowledgeCategory(
      adminContext(),
      { name: "Cat B", description: null, sortOrder: 2 },
      META,
      db,
    );
    const created = await createBusinessCategoryMappingAsAdmin(
      {
        requestedProjectCode: "us_bank_account",
        knowledgeCategoryId: catA.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    const updated = await updateBusinessCategoryMappingAsAdmin(
      created.id,
      {
        knowledgeCategoryId: catB.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    assert.equal(updated.knowledgeCategoryId, catB.id);
    assert.equal(updated.updatedByUserId, adminUser.id);
  });

  it("H/P: deactivate mapping stops resolver match", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "HK Preview", description: null, sortOrder: 1 },
      META,
      db,
    );
    const created = await createBusinessCategoryMappingAsAdmin(
      {
        requestedProjectCode: "hk_bank_account",
        knowledgeCategoryId: category.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    await updateBusinessCategoryMappingAsAdmin(
      created.id,
      { isActive: false, actorUserId: adminUser.id },
      db,
    );
    const resolution = await resolveKnowledgeCategoryForBusiness(
      "hk_bank_account",
      db,
    );
    assert.equal(resolution.status, "inactive_mapping");
  });

  it("I: reactivate inactive row via admin create reuses row", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "HK Preview", description: null, sortOrder: 1 },
      META,
      db,
    );
    const created = await createBusinessCategoryMapping(
      {
        requestedProjectCode: "hk_bank_account",
        knowledgeCategoryId: category.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    await deactivateBusinessCategoryMapping(created.id, adminUser.id, db);
    const cat2 = await createKnowledgeCategory(
      adminContext(),
      { name: "HK Preview 2", description: null, sortOrder: 2 },
      META,
      db,
    );
    const reactivated = await createBusinessCategoryMappingAsAdmin(
      {
        requestedProjectCode: "hk_bank_account",
        knowledgeCategoryId: cat2.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    assert.equal(reactivated.id, created.id);
    assert.equal(reactivated.isActive, true);
    assert.equal(reactivated.knowledgeCategoryId, cat2.id);
    const count = await db
      .select()
      .from(schema.knowledgeBusinessCategoryMappings);
    assert.equal(count.length, 1);
  });

  it("L: inactive target category status in admin list", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Inactive Target", description: null, sortOrder: 1 },
      META,
      db,
    );
    await createBusinessCategoryMappingAsAdmin(
      {
        requestedProjectCode: "hk_bank_account",
        knowledgeCategoryId: category.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    await db
      .update(schema.knowledgeCategories)
      .set({ isActive: false })
      .where(eq(schema.knowledgeCategories.id, category.id));
    const rows = await listBusinessCategoryMappingAdminRows("zh-Hans", db);
    const hk = rows.find((row) => row.requestedProjectCode === "hk_bank_account");
    assert.equal(hk?.status, "category_inactive");
  });

  it("O: explicit mapping used by Gate 2B organizer draft", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "P2C-A2 Preview", description: null, sortOrder: 1 },
      META,
      db,
    );
    await createBusinessCategoryMappingAsAdmin(
      {
        requestedProjectCode: "hk_bank_account",
        knowledgeCategoryId: category.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    const draft = await buildOrganizerDraftFromOrganization(
      minimalSource({
        id: "run-1",
        status: "completed",
        provider: "mock",
        model: "mock",
        proposedTitle: "T",
        proposedSummary: "S",
        proposedBody: "B",
        proposedCategory: null,
        businessIdentity: {
          title: "HK",
          countryGroupCode: "hong_kong",
          countryLabelZhHans: "香港",
          requestedProjectCode: "hk_bank_account",
          categoryMatch: "confident",
          signal: "hsbc_hk_banking",
          confidence: 5,
          identityConsistent: true,
        },
        warnings: [],
        failureCode: null,
        createdAt: "2026-01-01",
        completedAt: "2026-01-01",
      }),
      {
        manualRequestedProjectCode: null,
        manualRequestedProjectOverride: false,
        manualCategoryId: null,
        manualCategoryOverride: false,
      },
      db,
      {
        suggestCategory: async () => {
          throw new Error("AI must not run when explicit mapping exists");
        },
      },
    );
    assert.equal(draft.categoryId, category.id);
    assert.equal(draft.categoryResolutionSource, "explicit_mapping");
  });

  it("R: after deactivation AI fallback deps may run", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "HK Preview", description: null, sortOrder: 1 },
      META,
      db,
    );
    const mapping = await createBusinessCategoryMappingAsAdmin(
      {
        requestedProjectCode: "hk_bank_account",
        knowledgeCategoryId: category.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    await updateBusinessCategoryMappingAsAdmin(
      mapping.id,
      { isActive: false, actorUserId: adminUser.id },
      db,
    );
    let aiCalled = false;
    const draft = await buildOrganizerDraftFromOrganization(
      minimalSource({
        id: "run-1",
        status: "completed",
        provider: "mock",
        model: "mock",
        proposedTitle: "T",
        proposedSummary: "S",
        proposedBody: "B",
        proposedCategory: null,
        businessIdentity: {
          title: "HK",
          countryGroupCode: "hong_kong",
          countryLabelZhHans: "香港",
          requestedProjectCode: "hk_bank_account",
          categoryMatch: "confident",
          signal: "hsbc_hk_banking",
          confidence: 5,
          identityConsistent: true,
        },
        warnings: [],
        failureCode: null,
        createdAt: "2026-01-01",
        completedAt: "2026-01-01",
      }),
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
            categoryId: category.id,
            categoryName: category.name,
            resolutionSource: "ai_suggestion",
            requiresConfirmation: false,
          };
        },
      },
    );
    assert.equal(aiCalled, true);
    assert.equal(draft.categoryResolutionSource, "ai_suggestion");
  });

  it("C/D: invalid business and inactive category rejected on create", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Inactive", description: null, sortOrder: 1 },
      META,
      db,
    );
    await db
      .update(schema.knowledgeCategories)
      .set({ isActive: false })
      .where(eq(schema.knowledgeCategories.id, category.id));
    await assert.rejects(
      () =>
        createBusinessCategoryMappingAsAdmin(
          {
            requestedProjectCode: "not_a_real_business_code",
            knowledgeCategoryId: category.id,
            actorUserId: adminUser.id,
          },
          db,
        ),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        return true;
      },
    );
    const active = await createKnowledgeCategory(
      adminContext(),
      { name: "Active", description: null, sortOrder: 2 },
      META,
      db,
    );
    await assert.rejects(
      () =>
        createBusinessCategoryMappingAsAdmin(
          {
            requestedProjectCode: "hk_bank_account",
            knowledgeCategoryId: category.id,
            actorUserId: adminUser.id,
          },
          db,
        ),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        return true;
      },
    );
    const mapping = await createBusinessCategoryMappingAsAdmin(
      {
        requestedProjectCode: "hk_bank_account",
        knowledgeCategoryId: active.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    assert.ok(mapping.id);
  });
});

describe("knowledge business category mapping admin API guards", () => {
  it("B: mapping routes require knowledge_admin", () => {
    const listRoute = readFileSync(
      join(root, "src/app/api/knowledge/business-category-mappings/route.ts"),
      "utf8",
    );
    const patchRoute = readFileSync(
      join(
        root,
        "src/app/api/knowledge/business-category-mappings/[id]/route.ts",
      ),
      "utf8",
    );
    assert.match(listRoute, /requireKnowledgeAdmin/);
    assert.match(patchRoute, /requireKnowledgeAdmin/);
  });
});

describe("knowledge business category mapping admin UI", () => {
  it("M/N: UI uses canonical taxonomy and mapping API", () => {
    const mappingUi = readFileSync(
      join(root, "src/components/knowledge/knowledge-business-mapping-admin.tsx"),
      "utf8",
    );
    const categoriesUi = readFileSync(
      join(root, "src/components/knowledge/knowledge-categories-client.tsx"),
      "utf8",
    );
    assert.match(mappingUi, /searchRequestedProjectItems/);
    assert.match(mappingUi, /business-category-mappings/);
    assert.match(categoriesUi, /tabBusinessMapping/);
    assert.doesNotMatch(mappingUi, /canonicalZhHans.*===.*category\.name/);
  });
});
