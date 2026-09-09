import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  archiveKnowledgeArticle,
  createKnowledgeArticle,
  createKnowledgeCategory,
  deleteKnowledgeCategory,
  getKnowledgeArticle,
  getKnowledgeArticleVersion,
  listKnowledgeArticleVersions,
  listKnowledgeArticles,
  updateKnowledgeArticle,
} from "@/lib/knowledge/core-service";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";

const META = { ipAddress: null, userAgent: "knowledge-package2-test" };

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let staffUser: User;

const adminContext = () => ({
  user: adminUser,
  sessionId: "package2-admin-session",
  role: "knowledge_admin" as const,
});

const contributorContext = () => ({
  user: staffUser,
  sessionId: "package2-staff-session",
  role: "contributor" as const,
});

async function cleanup(): Promise<void> {
  await db.delete(schema.knowledgeArticleVersions);
  await db.delete(schema.knowledgeArticles);
  await db.delete(schema.knowledgeCategories);
  await db
    .delete(schema.auditLogs)
    .where(like(schema.auditLogs.action, "knowledge_%"));
}

async function assertError(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof KnowledgeServiceError);
    assert.equal(error.errorCode, code);
    return true;
  });
}

describe("Knowledge Package 2 core service", () => {
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
    staffUser = (
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, SEED_IDS.staffA))
        .limit(1)
    )[0] as User;
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("creates categories and rejects unsafe deletion", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "海外银行业务", description: "合成测试分类", sortOrder: 1 },
      META,
      db,
    );
    assert.equal(category.isActive, true);
    await createKnowledgeArticle(
      contributorContext(),
      {
        title: "海外银行账户服务流程示例",
        categoryId: category.id,
        summary: "合成测试文章",
        body: "这是仅用于自动化测试的文章正文。",
        visibility: "team",
      },
      META,
      db,
    );
    await assertError(
      () => deleteKnowledgeCategory(adminContext(), category.id, db),
      "KNOWLEDGE_CATEGORY_HAS_ARTICLES",
    );
  });

  it("creates v1, atomically updates to v2, and keeps history immutable", async () => {
    const category = (
      await db
        .select()
        .from(schema.knowledgeCategories)
        .limit(1)
    )[0];
    assert.ok(category);
    const created = await createKnowledgeArticle(
      contributorContext(),
      {
        title: "版本测试文章",
        categoryId: category.id,
        body: "第一版正文",
        visibility: "team",
      },
      META,
      db,
    );
    assert.equal(created.currentVersionNumber, 1);
    const updated = await updateKnowledgeArticle(
      contributorContext(),
      created.id,
      {
        title: "版本测试文章更新",
        categoryId: category.id,
        body: "第二版正文",
        visibility: "team",
        expectedUpdatedAt: created.updatedAt,
        changeNote: "修正示例步骤",
      },
      META,
      db,
    );
    assert.equal(updated.currentVersionNumber, 2);
    assert.equal((await listKnowledgeArticleVersions(
      contributorContext(),
      created.id,
      db,
    )).length, 2);
    const oldVersion = await getKnowledgeArticleVersion(
      contributorContext(),
      created.id,
      1,
      META,
      db,
    );
    assert.equal(oldVersion.bodySnapshot, "第一版正文");
    await assertError(
      () =>
        updateKnowledgeArticle(
          contributorContext(),
          created.id,
          {
            title: "过期修改",
            categoryId: category.id,
            body: "不应覆盖",
            visibility: "team",
            expectedUpdatedAt: created.updatedAt,
          },
          META,
          db,
        ),
      "KNOWLEDGE_ARTICLE_CONFLICT",
    );
  });

  it("enforces owner visibility and archives without publishing", async () => {
    const category = (
      await db
        .select()
        .from(schema.knowledgeCategories)
        .limit(1)
    )[0];
    assert.ok(category);
    const created = await createKnowledgeArticle(
      contributorContext(),
      {
        title: "Owner 文章",
        categoryId: category.id,
        body: "仅作者与管理员可见",
        visibility: "owner",
      },
      META,
      db,
    );
    assert.equal(
      (await listKnowledgeArticles(contributorContext(), {}, db)).some(
        (article) => article.id === created.id,
      ),
      true,
    );
    assert.equal(
      (await listKnowledgeArticles(
        { ...adminContext(), role: "viewer" as const },
        {},
        db,
      )).some((article) => article.id === created.id),
      false,
    );
    assert.equal(
      (await getKnowledgeArticle(adminContext(), created.id, db)).title,
      "Owner 文章",
    );
    const archived = await archiveKnowledgeArticle(
      adminContext(),
      created.id,
      created.updatedAt,
      META,
      db,
    );
    assert.equal(archived.status, "archived");
  });

  it("keeps Package 2 tables independent from customer data", async () => {
    const tableSql = await db.all<{ name: string; sql: string }>(
      sql`SELECT name, sql FROM sqlite_master
          WHERE name IN (
            'knowledge_categories',
            'knowledge_articles',
            'knowledge_article_versions'
          )`,
    );
    assert.equal(tableSql.length, 3);
    assert.ok(tableSql.every((table) => !/customer_id|contact_id|lead_id|mail_message_id|approval_id|follow_up_id/.test(table.sql)));
    assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);
    assert.equal(
      (await db.all<{ quick_check: string }>(sql`PRAGMA quick_check`))[0]
        ?.quick_check,
      "ok",
    );
    const audits = await db
      .select({ metadata: schema.auditLogs.metadata })
      .from(schema.auditLogs)
      .where(like(schema.auditLogs.action, "knowledge_article_%"));
    assert.ok(audits.every((audit) => !audit.metadata?.includes("第一版正文")));
  });
});
