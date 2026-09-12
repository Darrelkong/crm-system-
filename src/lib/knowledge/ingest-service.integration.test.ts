import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import { createKnowledgeCategory } from "@/lib/knowledge/core-service";
import {
  createKnowledgeFileSource,
  createKnowledgePasteSource,
  convertKnowledgeSourceToDraft,
  getKnowledgeSource,
} from "@/lib/knowledge/source-service";
import { organizeKnowledgeSource } from "@/lib/knowledge/ai-organizer-service";
import { createMemoryKnowledgeSourceStorage } from "@/lib/knowledge/source-storage";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";

const META = { ipAddress: null, userAgent: "knowledge-package3-test" };
let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let staffUser: User;

const adminContext = () => ({
  user: adminUser,
  sessionId: "package3-admin-session",
  role: "knowledge_admin" as const,
});

const contributorContext = () => ({
  user: staffUser,
  sessionId: "package3-staff-session",
  role: "contributor" as const,
});

const viewerContext = () => ({
  user: staffUser,
  sessionId: "package3-viewer-session",
  role: "viewer" as const,
});

async function cleanup() {
  await db.delete(schema.knowledgeAiOrganizationRuns);
  await db.delete(schema.knowledgeSources);
  await db.delete(schema.knowledgeArticleVersions);
  await db.delete(schema.knowledgeArticles);
  await db.delete(schema.knowledgeCategories);
  await db.delete(schema.auditLogs).where(like(schema.auditLogs.action, "knowledge_%"));
}

async function assertCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof KnowledgeServiceError);
    assert.equal(error.errorCode, code);
    return true;
  });
}

describe("Knowledge Package 3 ingest lifecycle", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    adminUser = (
      await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.admin)).limit(1)
    )[0] as User;
    staffUser = (
      await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffA)).limit(1)
    )[0] as User;
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("persists a paste source before any AI run", async () => {
    const source = await createKnowledgePasteSource(
      contributorContext(),
      {
        sourceTitle: "合成海外银行流程",
        rawText:
          "本文件仅为系统测试示例。\n具体银行要求以实际审核结果为准。",
      },
      META,
      db,
    );
    assert.equal(source.status, "ready");
    assert.equal(source.organization, null);
    assert.equal(
      (await db.select().from(schema.knowledgeAiOrganizationRuns)).length,
      0,
    );
  });

  it("organizes with the test mock, creates Article v1 as draft, and blocks repeat conversion", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "海外银行业务", description: "合成测试分类" },
      META,
      db,
    );
    const source = await createKnowledgePasteSource(
      contributorContext(),
      {
        rawText:
          "需求确认后再整理资料。\n具体银行要求以实际审核结果为准。",
      },
      META,
      db,
    );
    const organized = await organizeKnowledgeSource(
      contributorContext(),
      source.id,
      META,
      db,
    );
    assert.equal(organized.status, "organized");
    assert.equal(organized.organization?.status, "completed");
    const article = await convertKnowledgeSourceToDraft(
      contributorContext(),
      source.id,
      {
        title: "人工审阅后的海外银行流程",
        summary: "仅保留来源支持的内容。",
        body: "需求确认后再整理资料。\n具体银行要求以实际审核结果为准。",
        categoryId: category.id,
        visibility: "team",
      },
      META,
      db,
    );
    assert.equal(article.status, "draft");
    assert.equal(article.currentVersionNumber, 1);
    const converted = await getKnowledgeSource(
      contributorContext(),
      source.id,
      db,
    );
    assert.equal(converted.status, "converted");
    assert.equal(converted.linkedArticleId, article.id);
    assert.equal(converted.organization?.status, "completed");
    await assertCode(
      () =>
        convertKnowledgeSourceToDraft(
          contributorContext(),
          source.id,
          {
            title: "重复",
            body: "不应建立第二篇文章",
            categoryId: category.id,
            visibility: "team",
          },
          META,
          db,
        ),
      "SOURCE_ALREADY_CONVERTED",
    );
  });

  it("keeps failed conversion unconverted and denies viewer ingestion", async () => {
    const source = await createKnowledgePasteSource(
      contributorContext(),
      { rawText: "仅用于失败路径测试的来源内容。" },
      META,
      db,
    );
    await organizeKnowledgeSource(contributorContext(), source.id, META, db);
    await assertCode(
      () =>
        convertKnowledgeSourceToDraft(
          contributorContext(),
          source.id,
          {
            title: "无效分类",
            body: "人工正文",
            categoryId: "missing-category",
            visibility: "team",
          },
          META,
          db,
        ),
      "KNOWLEDGE_CATEGORY_INVALID",
    );
    assert.equal(
      (await getKnowledgeSource(contributorContext(), source.id, db)).status,
      "organized",
    );
    await assertCode(
      () =>
        createKnowledgePasteSource(
          viewerContext(),
          { rawText: "viewer 不应建立来源" },
          META,
          db,
        ),
      "KNOWLEDGE_ROLE_REQUIRED",
    );
  });

  it("stores file bytes in the dedicated adapter and safely marks invalid PDF extraction as failed", async () => {
    const storage = createMemoryKnowledgeSourceStorage();
    const pdfBytes = new TextEncoder().encode("synthetic PDF bytes").buffer;
    const source = await createKnowledgeFileSource(
      contributorContext(),
      {
        name: "synthetic.pdf",
        type: "application/pdf",
        size: pdfBytes.byteLength,
        arrayBuffer: async () => pdfBytes,
      },
      META,
      db,
      storage,
    ).catch((error: unknown) => {
      assert.ok(error instanceof KnowledgeServiceError);
      assert.equal(error.errorCode, "TEXT_EXTRACTION_FAILED");
      return null;
    });
    assert.equal(source, null);
    const failed = (
      await db
        .select()
        .from(schema.knowledgeSources)
        .where(eq(schema.knowledgeSources.originalFilename, "synthetic.pdf"))
        .limit(1)
    )[0];
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.failureCode, "TEXT_EXTRACTION_FAILED");
    assert.ok(failed?.storageKey);
    assert.ok(await storage.get(failed!.storageKey!));
  });

  it("extracts DOCX and text PDF into ready sources for Organizer", async () => {
    const storage = createMemoryKnowledgeSourceStorage();
    const { buildTestDocxBytes, buildTestTextPdfBytes } = await import(
      "@/lib/knowledge/test-fixtures/source-documents"
    );
    const docxBytes = await buildTestDocxBytes({
      paragraphs: ["Organizer-ready DOCX body"],
    });
    const docx = await createKnowledgeFileSource(
      contributorContext(),
      {
        name: "organizer.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: docxBytes.byteLength,
        arrayBuffer: async () => docxBytes,
      },
      META,
      db,
      storage,
    );
    assert.equal(docx.status, "ready");
    assert.match(docx.rawText ?? "", /Organizer-ready DOCX body/);

    const pdfBytes = buildTestTextPdfBytes(["Organizer-ready PDF body"]);
    const pdf = await createKnowledgeFileSource(
      contributorContext(),
      {
        name: "organizer.pdf",
        type: "application/pdf",
        size: pdfBytes.byteLength,
        arrayBuffer: async () => pdfBytes,
      },
      META,
      db,
      storage,
    );
    assert.equal(pdf.status, "ready");
    assert.match(pdf.rawText ?? "", /Organizer-ready PDF body/);
  });
});
