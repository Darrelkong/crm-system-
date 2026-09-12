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
  markKnowledgeSourceOrganizing,
} from "@/lib/knowledge/source-service";
import {
  createMemoryKnowledgeSourceStorage,
  getKnowledgeSourceStorage,
} from "@/lib/knowledge/source-storage";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";

const META = { ipAddress: null, userAgent: "knowledge-source-archive-test" };
let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let staffUser: User;
let staffBUser: User;
const storage = createMemoryKnowledgeSourceStorage();
const originalStorage = getKnowledgeSourceStorage();

const adminContext = () => ({
  user: adminUser,
  sessionId: "source-archive-admin",
  role: "knowledge_admin" as const,
});

const contributorContext = () => ({
  user: staffUser,
  sessionId: "source-archive-contributor",
  role: "contributor" as const,
});

const otherContributorContext = () => ({
  user: staffBUser,
  sessionId: "source-archive-contributor-b",
  role: "contributor" as const,
});

const reviewerContext = () => ({
  user: staffUser,
  sessionId: "source-archive-reviewer",
  role: "reviewer" as const,
});

const viewerContext = () => ({
  user: staffUser,
  sessionId: "source-archive-viewer",
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

let archivePasteCounter = 0;

async function createPasteSource(
  context = contributorContext(),
  title = "Archive test source",
) {
  archivePasteCounter += 1;
  return createKnowledgePasteSource(
    context,
    {
      sourceTitle: title,
      rawText: `ORBIT-ARCHIVE 三步流程測試內容 #${archivePasteCounter} · ${title}`,
    },
    META,
    db,
  );
}

describe("Knowledge source archive lifecycle", () => {
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

  it("allows Knowledge Admin to archive an active source", async () => {
    const source = await createPasteSource(contributorContext());
    const archived = await archiveKnowledgeSource(
      adminContext(),
      source.id,
      source.updatedAt,
      META,
      db,
    );
    assert.ok(archived.archivedAt);
    assert.equal(archived.archivedByUserId, adminUser.id);
    assert.equal(archived.status, "ready");
    assert.equal(archived.rawText, source.rawText);
  });

  it("allows Contributor to archive own active source", async () => {
    const source = await createPasteSource();
    const archived = await archiveKnowledgeSource(
      contributorContext(),
      source.id,
      source.updatedAt,
      META,
      db,
    );
    assert.ok(archived.archivedAt);
    assert.equal(archived.archivedByUserId, staffUser.id);
  });

  it("denies Contributor archiving another user's source", async () => {
    const source = await createPasteSource(otherContributorContext());
    await assertCode(
      () =>
        archiveKnowledgeSource(
          contributorContext(),
          source.id,
          source.updatedAt,
          META,
          db,
        ),
      KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED,
    );
  });

  it("denies Reviewer source archive", async () => {
    const source = await createPasteSource();
    await assertCode(
      () =>
        archiveKnowledgeSource(
          reviewerContext(),
          source.id,
          source.updatedAt,
          META,
          db,
        ),
      KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED,
    );
  });

  it("denies Viewer source archive", async () => {
    const source = await createPasteSource();
    await assertCode(
      () =>
        archiveKnowledgeSource(
          viewerContext(),
          source.id,
          source.updatedAt,
          META,
          db,
        ),
      KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED,
    );
  });

  it("prevents former Contributor with Reviewer role from accessing owned source", async () => {
    const source = await createPasteSource();
    await assertCode(
      () => getKnowledgeSource(reviewerContext(), source.id, db),
      KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED,
    );
    await assertCode(
      () => listKnowledgeSources(reviewerContext(), { lifecycle: "active" }, db),
      KNOWLEDGE_ERROR_CODES.ROLE_REQUIRED,
    );
    await assertCode(
      () =>
        archiveKnowledgeSource(
          reviewerContext(),
          source.id,
          source.updatedAt,
          META,
          db,
        ),
      KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED,
    );
    await assertCode(
      () => organizeKnowledgeSource(reviewerContext(), source.id, META, db),
      KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED,
    );
  });

  it("prevents former Contributor with Viewer role from accessing owned source", async () => {
    const source = await createPasteSource();
    await assertCode(
      () => getKnowledgeSource(viewerContext(), source.id, db),
      KNOWLEDGE_ERROR_CODES.SOURCE_ACCESS_DENIED,
    );
    await assertCode(
      () => listKnowledgeSources(viewerContext(), { lifecycle: "active" }, db),
      KNOWLEDGE_ERROR_CODES.ROLE_REQUIRED,
    );
  });

  it("rejects archiving an already archived source", async () => {
    const source = await createPasteSource();
    await archiveKnowledgeSource(
      adminContext(),
      source.id,
      source.updatedAt,
      META,
      db,
    );
    const current = await getKnowledgeSource(adminContext(), source.id, db);
    await assertCode(
      () =>
        archiveKnowledgeSource(
          adminContext(),
          source.id,
          current.updatedAt,
          META,
          db,
        ),
      KNOWLEDGE_ERROR_CODES.SOURCE_ALREADY_ARCHIVED,
    );
  });

  it("rejects archive while source is organizing", async () => {
    const source = await createPasteSource();
    await markKnowledgeSourceOrganizing(contributorContext(), source.id, db);
    const current = await getKnowledgeSource(adminContext(), source.id, db);
    await assertCode(
      () =>
        archiveKnowledgeSource(
          adminContext(),
          source.id,
          current.updatedAt,
          META,
          db,
        ),
      KNOWLEDGE_ERROR_CODES.SOURCE_NOT_ARCHIVABLE,
    );
  });

  it("rejects archive with stale expectedUpdatedAt", async () => {
    const source = await createPasteSource();
    await assertCode(
      () =>
        archiveKnowledgeSource(
          adminContext(),
          source.id,
          "1970-01-01T00:00:00.000Z",
          META,
          db,
        ),
      KNOWLEDGE_ERROR_CODES.SOURCE_INVALID,
    );
  });

  it("hides archived sources from active list and shows them in archived filter", async () => {
    const active = await createPasteSource(contributorContext(), "Active source");
    const toArchive = await createPasteSource(contributorContext(), "Archived source");
    await archiveKnowledgeSource(
      contributorContext(),
      toArchive.id,
      toArchive.updatedAt,
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
    const activeIds = activeList.map((row) => row.id);
    assert.ok(activeIds.includes(active.id));
    assert.ok(!activeIds.includes(toArchive.id));
    assert.ok(archivedList.some((row) => row.id === toArchive.id));
    const adminArchived = await listKnowledgeSources(
      adminContext(),
      { lifecycle: "archived" },
      db,
    );
    assert.ok(adminArchived.some((row) => row.id === toArchive.id));
  });

  it("blocks Organizer and convert on archived sources while preserving history", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Archive category", description: null },
      META,
      db,
    );
    const source = await createPasteSource();
    await organizeKnowledgeSource(contributorContext(), source.id, META, db);
    const organized = await getKnowledgeSource(contributorContext(), source.id, db);
    assert.equal(organized.organization?.status, "completed");
    await archiveKnowledgeSource(
      adminContext(),
      source.id,
      organized.updatedAt,
      META,
      db,
    );
    const archived = await getKnowledgeSource(adminContext(), source.id, db);
    assert.equal(archived.organization?.status, "completed");
    await assertCode(
      () => organizeKnowledgeSource(contributorContext(), source.id, META, db),
      KNOWLEDGE_ERROR_CODES.SOURCE_ARCHIVED,
    );
    await assertCode(
      () =>
        convertKnowledgeSourceToDraft(
          contributorContext(),
          source.id,
          {
            title: "Draft",
            body: "Body",
            categoryId: category.id,
          },
          META,
          db,
        ),
      KNOWLEDGE_ERROR_CODES.SOURCE_ARCHIVED,
    );
  });

  it("retains file storage key and does not delete R2 object on archive", async () => {
    const bytes = new TextEncoder().encode("file archive test");
    const file = {
      name: "archive.txt",
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
    const archived = await archiveKnowledgeSource(
      adminContext(),
      source.id,
      source.updatedAt,
      META,
      db,
    );
    assert.equal(archived.storageKey, source.storageKey);
    assert.ok(await storage.get(source.storageKey!));
    assert.equal(originalStorage, getKnowledgeSourceStorage());
  });

  it("does not change linked published article search eligibility after source archive", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Published archive category", description: null },
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
        title: "Published from archived source",
        body: organized.organization?.proposedBody ?? "Published body ORBIT-ARCHIVE",
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
    await approveAndPublishKnowledgeReview(
      adminContext(),
      review.id,
      META,
      db,
    );
    const linkedSource = await getKnowledgeSource(adminContext(), source.id, db);
    await archiveKnowledgeSource(
      adminContext(),
      source.id,
      linkedSource.updatedAt,
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
      "ORBIT-ARCHIVE",
      db,
    );
    assert.ok(hits.some((hit) => hit.articleId === article.id));
  });

  it("writes knowledge_source_archived audit metadata without raw text", async () => {
    const source = await createPasteSource();
    await archiveKnowledgeSource(
      adminContext(),
      source.id,
      source.updatedAt,
      META,
      db,
    );
    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "knowledge_source_archived"),
          eq(schema.auditLogs.entityId, source.id),
        ),
      )
      .limit(1);
    assert.equal(audit.length, 1);
    const metadata = JSON.parse(audit[0]?.metadata ?? "{}") as Record<string, unknown>;
    assert.equal(metadata.sourceId, source.id);
    assert.equal(metadata.previousStatus, "ready");
    assert.equal(metadata.linkedArticleId, null);
    assert.equal(metadata.rawText, undefined);
  });
});
