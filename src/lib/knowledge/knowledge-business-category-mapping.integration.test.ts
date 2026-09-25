import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { getRequestedProjectItem } from "@/lib/constants/requested-projects";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { createKnowledgeCategory } from "@/lib/knowledge/core-service";
import {
  createBusinessCategoryMapping,
  deactivateBusinessCategoryMapping,
  getMappingByRequestedProjectCode,
  resolveKnowledgeCategoryForBusiness,
} from "@/lib/knowledge/knowledge-business-category-mapping-service";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";

const META = { ipAddress: null, userAgent: "knowledge-mapping-2a-test" };

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;

const adminContext = () => ({
  user: adminUser,
  sessionId: "mapping-2a-admin-session",
  role: "knowledge_admin" as const,
});

async function cleanup(): Promise<void> {
  await db.delete(schema.knowledgeBusinessCategoryMappings);
  await db.delete(schema.knowledgeArticleVersions);
  await db.delete(schema.knowledgeArticles);
  await db.delete(schema.knowledgeCategories);
}

async function assertError(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof KnowledgeServiceError);
    assert.equal(error.errorCode, code);
    return true;
  });
}

describe("knowledge business category mapping foundation", () => {
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

  it("A: valid mapping + active category resolves matched", async () => {
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
    const resolution = await resolveKnowledgeCategoryForBusiness(
      "us_bank_account",
      db,
    );
    assert.equal(resolution.status, "matched");
    assert.equal(resolution.categoryId, category.id);
    assert.equal(resolution.resolutionSource, "explicit_mapping");
  });

  it("B: no mapping resolves unmapped", async () => {
    const resolution = await resolveKnowledgeCategoryForBusiness(
      "hk_bank_account",
      db,
    );
    assert.equal(resolution.status, "unmapped");
    assert.equal(resolution.resolutionSource, null);
  });

  it("C: invalid business code resolves invalid_business", async () => {
    const resolution = await resolveKnowledgeCategoryForBusiness(
      "not_a_real_business_code",
      db,
    );
    assert.equal(resolution.status, "invalid_business");
  });

  it("D: mapping to inactive category does not match", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "停用分类", description: null, sortOrder: 2 },
      META,
      db,
    );
    const mapping = await createBusinessCategoryMapping(
      {
        requestedProjectCode: "sg_bank_account",
        knowledgeCategoryId: category.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    await db
      .update(schema.knowledgeCategories)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(schema.knowledgeCategories.id, category.id));
    const resolution = await resolveKnowledgeCategoryForBusiness(
      "sg_bank_account",
      db,
    );
    assert.equal(resolution.status, "inactive_category");
    assert.equal(resolution.categoryId, undefined);
    await deactivateBusinessCategoryMapping(mapping.id, adminUser.id, db);
  });

  it("E: inactive mapping does not match", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "香港银行账户", description: null, sortOrder: 3 },
      META,
      db,
    );
    const mapping = await createBusinessCategoryMapping(
      {
        requestedProjectCode: "hk_bank_account",
        knowledgeCategoryId: category.id,
        actorUserId: adminUser.id,
      },
      db,
    );
    await deactivateBusinessCategoryMapping(mapping.id, adminUser.id, db);
    const resolution = await resolveKnowledgeCategoryForBusiness(
      "hk_bank_account",
      db,
    );
    assert.equal(resolution.status, "inactive_mapping");
  });

  it("F: rejects invalid requested_project_code on create", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "临时", description: null, sortOrder: 4 },
      META,
      db,
    );
    await assertError(
      () =>
        createBusinessCategoryMapping(
          {
            requestedProjectCode: "chase_brand_only",
            knowledgeCategoryId: category.id,
          },
          db,
        ),
      "KNOWLEDGE_CATEGORY_INVALID",
    );
  });

  it("G: rejects nonexistent category", async () => {
    await assertError(
      () =>
        createBusinessCategoryMapping(
          {
            requestedProjectCode: "us_bank_account",
            knowledgeCategoryId: "missing-category-id",
          },
          db,
        ),
      "KNOWLEDGE_CATEGORY_NOT_FOUND",
    );
  });

  it("H: rejects inactive category on create", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "未启用", description: null, sortOrder: 5 },
      META,
      db,
    );
    await db
      .update(schema.knowledgeCategories)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(schema.knowledgeCategories.id, category.id));
    await assertError(
      () =>
        createBusinessCategoryMapping(
          {
            requestedProjectCode: "us_bank_account",
            knowledgeCategoryId: category.id,
          },
          db,
        ),
      "KNOWLEDGE_CATEGORY_INVALID",
    );
  });

  it("I: duplicate requested_project_code rejected", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "重复测试", description: null, sortOrder: 6 },
      META,
      db,
    );
    await createBusinessCategoryMapping(
      {
        requestedProjectCode: "us_bank_account",
        knowledgeCategoryId: category.id,
      },
      db,
    );
    await assertError(
      () =>
        createBusinessCategoryMapping(
          {
            requestedProjectCode: "us_bank_account",
            knowledgeCategoryId: category.id,
          },
          db,
        ),
      "KNOWLEDGE_CATEGORY_INVALID",
    );
  });

  it("J: equal CRM label and category name without mapping stays unmapped", async () => {
    const item = getRequestedProjectItem("us_bank_account");
    assert.ok(item);
    await createKnowledgeCategory(
      adminContext(),
      { name: item.canonicalZhHans, description: null, sortOrder: 7 },
      META,
      db,
    );
    const resolution = await resolveKnowledgeCategoryForBusiness(
      "us_bank_account",
      db,
    );
    assert.equal(resolution.status, "unmapped");
    const mapping = await getMappingByRequestedProjectCode(
      "us_bank_account",
      db,
    );
    assert.equal(mapping, null);
  });

  it("K/L: resolver has no AI dependency and needs no source context", async () => {
    const source = await import(
      "@/lib/knowledge/knowledge-business-category-mapping-service"
    );
    assert.equal(typeof source.resolveKnowledgeCategoryForBusiness, "function");
    assert.doesNotMatch(
      String(source.resolveKnowledgeCategoryForBusiness),
      /callKnowledge|crm-ai|organizer/i,
    );
    const resolution = await resolveKnowledgeCategoryForBusiness("", db);
    assert.equal(resolution.status, "invalid_business");
  });
});
