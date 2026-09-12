import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import { createKnowledgeCategory } from "@/lib/knowledge/core-service";
import {
  approveAndPublishKnowledgeReview,
  submitKnowledgeReview,
} from "@/lib/knowledge/review-service";
import { searchPublishedKnowledge } from "@/lib/knowledge/published-retrieval";
import { organizeKnowledgeSource } from "@/lib/knowledge/ai-organizer-service";
import {
  archiveKnowledgeSource,
  createKnowledgeFileSource,
  createKnowledgePasteSource,
  convertKnowledgeSourceToDraft,
  getKnowledgeSource,
  listKnowledgeSources,
  restoreKnowledgeSource,
} from "@/lib/knowledge/source-service";
import {
  createMemoryKnowledgeSourceStorage,
  getKnowledgeSourceStorage,
} from "@/lib/knowledge/source-storage";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";

const META = { ipAddress: null, userAgent: "knowledge-source-restore-test" };
let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let staffUser: User;
let staffBUser: User;
const storage = createMemoryKnowledgeSourceStorage();
const originalStorage = getKnowledgeSourceStorage();

const adminContext = () => ({
  user: adminUser,
  sessionId: "source-restore-admin",
  role: "knowledge_admin" as const,
});

const contributorContext = () => ({
  user: staffUser,
  sessionId: "source-restore-contributor",
  role: "contributor" as const,
});

const otherContributorContext = () => ({
  user: staffBUser,
  sessionId: "source-restore-contributor-b",
  role: "contributor" as const,
});

const reviewerContext = () => ({
  user: staffUser,
  sessionId: "source-restore-reviewer",
  role: "reviewer" as const,
});

const viewerContext = () => ({
  user: staffUser,
  sessionId: "source-restore-viewer",
  role: "viewer" as const,
});

async function cleanup() {
  await db.delete(schema.knowledgeAiQueryRuns);
  await db.delete(schema.knowledgeAiOrganizationRuns);
  await db.delete(schema.knowledgeSources);
  await db.delete(schema.knowledgeArticlePublications);
  await db.delete(schema.knowledgeReviewRequests);
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

let restorePasteCounter = 0;

async function createPasteSource(
  context = contributorContext(),
  title = "Restore test source",
) {
  restorePasteCounter += 1;
  return createKnowledgePasteSource(
    context,
    {
      sourceTitle: title,
      rawText: `ORBIT-RESTORE 三步流程測試內容 #${restorePasteCounter} · ${title}`,
    },
    META,
    db,
  );
}

async function archiveSource(sourceId: string, updatedAt: string) {
  return archiveKnowledgeSource(adminContext(), sourceId, updatedAt, META, db);
}

describe("Knowledge source restore lifecycle", () => {
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
    staffBUser = (
      await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffB)).limit(1)
    )[0] as User;
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("allows Knowledge Admin to restore an archived source", async () => {
    const source = await createPasteSource();
    const archived = await archiveSource(source.id, source.updatedAt);
    const restored = await restoreKnowledgeSource(
      adminContext(),
      source.id,
      archived.updatedAt,
      META,
      db,
    );
    assert.equal(restored.archivedAt, null);
    assert.equal(restored.archivedByUserId, null);
    assert.equal(restored.status, "ready");
    assert.equal(restored.rawText, source.rawText);
  });

  it("allows Contributor to restore own archived source", async () => {
    const source = await createPasteSource();
    const archived = await archiveKnowledgeSource(
      contributorContext(),
      source.id,
      source.updatedAt,
      META,
      db,
    );
    const restored = await restoreKnowledgeSource(
      contributorContext(),
      source.id,
      archived.updatedAt,
      META,
      db,
    );
    assert.equal(restored.archivedAt, null);
    assert.equal(restored.archivedByUserId, null);
  });

  it("denies Contributor restoring another user's archived source", async () => {
    const source = await createPasteSource(otherContributorContext());
    const archived = await archiveSource(source.id, source.updatedAt);
    await assertCode(
      () =>
        restoreKnowledgeSource(
          contributorContext(),
          source.id,
          archived.updatedAt,
          META,
          db,
        ),
      KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED,
    );
  });

  it("denies Reviewer source restore", async () => {
    const source = await createPasteSource();
    const archived = await archiveSource(source.id, source.updatedAt);
    await assertCode(
      () =>
        restoreKnowledgeSource(
          reviewerContext(),
          source.id,
          archived.updatedAt,
          META,
          db,
        ),
      KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED,
    );
  });

  it("denies Viewer source restore", async () => {
    const source = await createPasteSource();
    const archived = await archiveSource(source.id, source.updatedAt);
    await assertCode(
      () =>
        restoreKnowledgeSource(
          viewerContext(),
          source.id,
          archived.updatedAt,
          META,
          db,
        ),
      KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED,
    );
  });

  it("prevents former Contributor with Reviewer role from restoring owned source", async () => {
    const source = await createPasteSource();
    const archived = await archiveSource(source.id, source.updatedAt);
    await assertCode(
      () =>
        restoreKnowledgeSource(
          reviewerContext(),
          source.id,
          archived.updatedAt,
          META,
          db,
        ),
      KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED,
    );
  });

  it("prevents former Contributor with Viewer role from restoring owned source", async () => {
    const source = await createPasteSource();
    const archived = await archiveSource(source.id, source.updatedAt);
    await assertCode(
      () =>
        restoreKnowledgeSource(
          viewerContext(),
          source.id,
          archived.updatedAt,
          META,
          db,
        ),
      KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED,
    );
  });

  it("rejects restoring an already active source", async () => {
    const source = await createPasteSource();
    await assertCode(
      () =>
        restoreKnowledgeSource(
          adminContext(),
          source.id,
          source.updatedAt,
          META,
          db,
        ),
      KNOWLEDGE_ERROR_CODES.SOURCE_NOT_ARCHIVED,
    );
  });

  it("rejects restore with stale expectedUpdatedAt", async () => {
    const source = await createPasteSource();
    const archived = await archiveSource(source.id, source.updatedAt);
    await assertCode(
      () =>
        restoreKnowledgeSource(
          adminContext(),
          source.id,
          "1970-01-01T00:00:00.000Z",
          META,
          db,
        ),
      KNOWLEDGE_ERROR_CODES.SOURCE_RESTORE_CONFLICT,
    );
    const stillArchived = await getKnowledgeSource(adminContext(), source.id, db);
    assert.ok(stillArchived.archivedAt);
    assert.equal(stillArchived.updatedAt, archived.updatedAt);
  });

  it("moves restored source from archived list back to active list", async () => {
    const source = await createPasteSource(contributorContext(), "Round trip source");
    const archived = await archiveSource(source.id, source.updatedAt);
    await restoreKnowledgeSource(
      contributorContext(),
      source.id,
      archived.updatedAt,
      META,
      db,
    );
    const activeList = await listKnowledgeSources(
      contributorContext(),
      { lifecycle: "active" },
      db,
    );
    const archivedList = await listKnowledgeSources(
      contributorContext(),
      { lifecycle: "archived" },
      db,
    );
    assert.ok(activeList.some((row) => row.id === source.id));
    assert.ok(!archivedList.some((row) => row.id === source.id));
  });

  it("preserves workflow status, content, and ownership across archive-restore round trip", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Restore category", description: null },
      META,
      db,
    );
    const source = await createPasteSource();
    await organizeKnowledgeSource(contributorContext(), source.id, META, db);
    const organized = await getKnowledgeSource(contributorContext(), source.id, db);
    const article = await convertKnowledgeSourceToDraft(
      contributorContext(),
      source.id,
      {
        title: "Converted draft",
        body: organized.organization?.proposedBody ?? "Body ORBIT-RESTORE",
        categoryId: category.id,
      },
      META,
      db,
    );
    const converted = await getKnowledgeSource(adminContext(), source.id, db);
    const beforeArchive = {
      id: converted.id,
      status: converted.status,
      rawText: converted.rawText,
      storageKey: converted.storageKey,
      contentHash: converted.contentHash,
      linkedArticleId: converted.linkedArticleId,
      createdByUserId: (
        await db
          .select()
          .from(schema.knowledgeSources)
          .where(eq(schema.knowledgeSources.id, source.id))
          .limit(1)
      )[0]?.createdByUserId,
      createdAt: converted.createdAt,
      orgRunCount: (
        await db
          .select()
          .from(schema.knowledgeAiOrganizationRuns)
          .where(eq(schema.knowledgeAiOrganizationRuns.sourceId, source.id))
      ).length,
    };
    const archived = await archiveSource(source.id, converted.updatedAt);
    const restored = await restoreKnowledgeSource(
      adminContext(),
      source.id,
      archived.updatedAt,
      META,
      db,
    );
    const afterRestore = {
      orgRunCount: (
        await db
          .select()
          .from(schema.knowledgeAiOrganizationRuns)
          .where(eq(schema.knowledgeAiOrganizationRuns.sourceId, source.id))
      ).length,
      articleCount: (
        await db
          .select()
          .from(schema.knowledgeArticles)
          .where(eq(schema.knowledgeArticles.id, article.id))
      ).length,
      versionCount: (
        await db
          .select()
          .from(schema.knowledgeArticleVersions)
          .where(eq(schema.knowledgeArticleVersions.articleId, article.id))
      ).length,
      reviewCount: (
        await db
          .select()
          .from(schema.knowledgeReviewRequests)
          .where(eq(schema.knowledgeReviewRequests.articleId, article.id))
      ).length,
      publicationCount: (
        await db
          .select()
          .from(schema.knowledgeArticlePublications)
          .where(eq(schema.knowledgeArticlePublications.articleId, article.id))
      ).length,
      queryRunCount: (await db.select().from(schema.knowledgeAiQueryRuns)).length,
    };
    assert.equal(restored.id, beforeArchive.id);
    assert.equal(restored.status, beforeArchive.status);
    assert.equal(restored.rawText, beforeArchive.rawText);
    assert.equal(restored.storageKey, beforeArchive.storageKey);
    assert.equal(restored.contentHash, beforeArchive.contentHash);
    assert.equal(restored.linkedArticleId, beforeArchive.linkedArticleId);
    assert.equal(restored.createdAt, beforeArchive.createdAt);
    assert.equal(
      (
        await db
          .select()
          .from(schema.knowledgeSources)
          .where(eq(schema.knowledgeSources.id, source.id))
          .limit(1)
      )[0]?.createdByUserId,
      beforeArchive.createdByUserId,
    );
    assert.equal(afterRestore.orgRunCount, beforeArchive.orgRunCount);
    assert.equal(afterRestore.articleCount, 1);
    assert.equal(afterRestore.versionCount, 1);
    assert.equal(afterRestore.reviewCount, 0);
    assert.equal(afterRestore.publicationCount, 0);
    assert.equal(afterRestore.queryRunCount, 0);
  });

  it("retains file storage key and does not mutate R2 object across archive-restore", async () => {
    const bytes = new TextEncoder().encode("file restore test");
    const file = {
      name: "restore.txt",
      type: "text/plain",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer.slice(0),
    };
    const source = await createKnowledgeFileSource(
      contributorContext(),
      file,
      META,
      db,
      storage,
    );
    assert.ok(source.storageKey);
    const archived = await archiveSource(source.id, source.updatedAt);
    assert.equal(archived.storageKey, source.storageKey);
    const restored = await restoreKnowledgeSource(
      adminContext(),
      source.id,
      archived.updatedAt,
      META,
      db,
    );
    assert.equal(restored.storageKey, source.storageKey);
    assert.ok(await storage.get(source.storageKey!));
    assert.equal(originalStorage, getKnowledgeSourceStorage());
  });

  it("does not change published article search eligibility after source restore", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Published restore category", description: null },
      META,
      db,
    );
    const source = await createPasteSource();
    await organizeKnowledgeSource(contributorContext(), source.id, META, db);
    const organized = await getKnowledgeSource(contributorContext(), source.id, db);
    const article = await convertKnowledgeSourceToDraft(
      contributorContext(),
      source.id,
      {
        title: "Published from restored source",
        body: organized.organization?.proposedBody ?? "Published body ORBIT-RESTORE",
        categoryId: category.id,
      },
      META,
      db,
    );
    const review = await submitKnowledgeReview(
      contributorContext(),
      { articleId: article.id },
      META,
      db,
    );
    await approveAndPublishKnowledgeReview(adminContext(), review.id, META, db);
    const linkedSource = await getKnowledgeSource(adminContext(), source.id, db);
    const archived = await archiveSource(source.id, linkedSource.updatedAt);
    await restoreKnowledgeSource(
      adminContext(),
      source.id,
      archived.updatedAt,
      META,
      db,
    );
    const unchangedArticle = await db
      .select()
      .from(schema.knowledgeArticles)
      .where(eq(schema.knowledgeArticles.id, article.id))
      .limit(1);
    assert.equal(unchangedArticle[0]?.status, "published");
    const hits = await searchPublishedKnowledge(
      viewerContext(),
      "ORBIT-RESTORE",
      db,
    );
    assert.ok(hits.some((hit) => hit.articleId === article.id));
  });

  it("writes knowledge_source_restored audit metadata without raw text", async () => {
    const source = await createPasteSource();
    const archived = await archiveSource(source.id, source.updatedAt);
    await restoreKnowledgeSource(
      adminContext(),
      source.id,
      archived.updatedAt,
      META,
      db,
    );
    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "knowledge_source_restored"),
          eq(schema.auditLogs.entityId, source.id),
        ),
      )
      .limit(1);
    assert.equal(audit.length, 1);
    const metadata = JSON.parse(audit[0]?.metadata ?? "{}") as Record<string, unknown>;
    assert.equal(metadata.sourceId, source.id);
    assert.equal(metadata.previousStatus, "ready");
    assert.equal(metadata.sourceType, "paste");
    assert.equal(metadata.linkedArticleId, null);
    assert.ok(metadata.archivedAt);
    assert.equal(metadata.rawText, undefined);
  });
});
