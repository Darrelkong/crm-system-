/**
 * LOCAL ONLY — seeds synthetic published Knowledge for P2C-A2 human preview.
 *
 * Usage:
 *   CRM_ALLOW_TEST_DB_BIND=1 CRM_ALLOW_MOCK_AI=1 node --import tsx scripts/seed-knowledge-comparison-preview.mjs
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../drizzle/schema/index.ts";
import { bindTestDatabase, getDb } from "../src/lib/db/index.ts";
import { SEED_IDS } from "../src/lib/constants/seed-ids.ts";
import { getTestD1PlatformProxy } from "../src/lib/mail/test-d1-platform-proxy.ts";
import {
  createKnowledgeArticle,
  createKnowledgeCategory,
} from "../src/lib/knowledge/core-service.ts";
import { createKnowledgePasteSource } from "../src/lib/knowledge/source-service.ts";
import { organizeKnowledgeSource } from "../src/lib/knowledge/ai-organizer-service.ts";

const META = { ipAddress: null, userAgent: "preview-seed" };

async function main() {
  const proxy = await getTestD1PlatformProxy();
  const db = drizzle(proxy.env.DB, { schema });
  bindTestDatabase(db);
  const adminUser = (
    await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.admin))
      .limit(1)
  )[0];
  if (!adminUser) {
    throw new Error("Seed admin user not found. Run db:seed:local first.");
  }

  const adminContext = {
    user: adminUser,
    sessionId: "preview-seed",
    role: "knowledge_admin",
  };

  const now = new Date().toISOString();
  const category = await createKnowledgeCategory(
    adminContext,
    {
      name: "P2C-A2 Preview",
      description: "Synthetic comparison preview category",
    },
    META,
    db,
  );

  const articleA = await createKnowledgeArticle(
    adminContext,
    {
      title: "汇丰香港测试知识",
      categoryId: category.id,
      body: "最低资产 50 万",
      visibility: "team",
    },
    META,
    db,
  );
  await db
    .update(schema.knowledgeArticles)
    .set({ status: "published", publishedVersionNumber: 1 })
    .where(eq(schema.knowledgeArticles.id, articleA.id));
  await db.insert(schema.knowledgeArticleVersions).values({
    id: crypto.randomUUID(),
    articleId: articleA.id,
    versionNumber: 2,
    titleSnapshot: "汇丰香港测试知识",
    summarySnapshot: null,
    bodySnapshot: "最低资产 80 万",
    categoryIdSnapshot: category.id,
    visibilitySnapshot: "team",
    ownerUserIdSnapshot: null,
    changeNote: "Unpublished draft for preview",
    createdByUserId: SEED_IDS.admin,
    createdAt: now,
  });
  await db
    .update(schema.knowledgeArticles)
    .set({ currentVersionNumber: 2 })
    .where(eq(schema.knowledgeArticles.id, articleA.id));

  const articleB = await createKnowledgeArticle(
    adminContext,
    {
      title: "无关保险产品说明",
      categoryId: category.id,
      body: "这是一篇无关主题的已发布知识。",
      visibility: "team",
    },
    META,
    db,
  );
  await db
    .update(schema.knowledgeArticles)
    .set({ status: "published", publishedVersionNumber: 1 })
    .where(eq(schema.knowledgeArticles.id, articleB.id));

  const articleC = await createKnowledgeArticle(
    adminContext,
    {
      title: "已归档历史知识",
      categoryId: category.id,
      body: "这篇知识已归档。",
      visibility: "team",
    },
    META,
    db,
  );
  await db
    .update(schema.knowledgeArticles)
    .set({ status: "archived", publishedVersionNumber: 1 })
    .where(eq(schema.knowledgeArticles.id, articleC.id));

  const articleD = await createKnowledgeArticle(
    adminContext,
    {
      title: "负责人限制知识",
      categoryId: category.id,
      body: "仅限负责人可见的内容。",
      visibility: "owner",
      ownerUserId: SEED_IDS.admin,
    },
    META,
    db,
  );
  await db
    .update(schema.knowledgeArticles)
    .set({ status: "published", publishedVersionNumber: 1 })
    .where(eq(schema.knowledgeArticles.id, articleD.id));

  const source = await createKnowledgePasteSource(
    adminContext,
    {
      sourceTitle: "P2C-A2 汇丰资产预览来源",
      rawText:
        "汇丰最新资料显示最低资产要求为 100 万，具体生效日期需经理确认。",
    },
    META,
    db,
  );

  await organizeKnowledgeSource(adminContext, source.id, META, db);

  console.log("P2C-A2 preview seed complete:");
  console.log(`  category: ${category.id}`);
  console.log(`  article A (published 50万, draft 80万): ${articleA.id}`);
  console.log(`  article B: ${articleB.id}`);
  console.log(`  article C (archived): ${articleC.id}`);
  console.log(`  article D (owner): ${articleD.id}`);
  console.log(`  source: ${source.id}`);
  await proxy.dispose();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
