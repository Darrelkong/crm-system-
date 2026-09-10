import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import {
  archiveKnowledgeArticle,
  createKnowledgeArticle,
  createKnowledgeCategory,
  getKnowledgeArticle,
  listKnowledgeArticles,
  updateKnowledgeArticle,
} from "@/lib/knowledge/core-service";
import {
  approveAndPublishKnowledgeReview,
  assignKnowledgeReview,
  requestKnowledgeReviewChanges,
  submitKnowledgeReview,
  withdrawKnowledgeReview,
} from "@/lib/knowledge/review-service";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";

const META = { ipAddress: null, userAgent: "knowledge-package4-test" };
let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let contributorUser: User;
let reviewerUser: User;

const adminContext = () => ({
  user: adminUser,
  sessionId: "package4-admin",
  role: "knowledge_admin" as const,
});
const contributorContext = () => ({
  user: contributorUser,
  sessionId: "package4-contributor",
  role: "contributor" as const,
});
const reviewerContext = () => ({
  user: reviewerUser,
  sessionId: "package4-reviewer",
  role: "reviewer" as const,
});
const viewerContext = () => ({
  user: contributorUser,
  sessionId: "package4-viewer",
  role: "viewer" as const,
});

async function cleanup() {
  await db.delete(schema.knowledgeArticlePublications);
  await db.delete(schema.knowledgeReviewRequests);
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

async function setRole(userId: string, role: "contributor" | "reviewer") {
  const now = new Date().toISOString();
  await db
    .insert(schema.knowledgeUserRoles)
    .values({
      userId,
      role,
      createdBy: adminUser.id,
      createdAt: now,
      updatedBy: adminUser.id,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.knowledgeUserRoles.userId,
      set: { role, updatedBy: adminUser.id, updatedAt: now },
    });
}

describe("Knowledge Package 4 review, publish, and isolation", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    adminUser = (await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.admin)).limit(1))[0] as User;
    contributorUser = (await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffA)).limit(1))[0] as User;
    reviewerUser = (await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffB)).limit(1))[0] as User;
    await cleanup();
    await setRole(contributorUser.id, "contributor");
    await setRole(reviewerUser.id, "reviewer");
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("pins exact versions, locks edits, and isolates viewers from working drafts", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Package 4 isolation", description: null },
      META,
      db,
    );
    const v1 = await createKnowledgeArticle(
      contributorContext(),
      {
        title: "Published v1",
        categoryId: category.id,
        summary: "v1 summary",
        body: "v1 body",
        visibility: "team",
      },
      META,
      db,
    );
    const firstReview = await submitKnowledgeReview(
      contributorContext(),
      { articleId: v1.id, submissionNote: "First review" },
      META,
      db,
    );
    assert.equal(firstReview.submittedVersionNumber, 1);
    await assertError(
      () =>
        submitKnowledgeReview(
          contributorContext(),
          { articleId: v1.id },
          META,
          db,
        ),
      "KNOWLEDGE_REVIEW_CONFLICT",
    );
    await assignKnowledgeReview(
      adminContext(),
      firstReview.id,
      reviewerUser.id,
      META,
      db,
    );
    await approveAndPublishKnowledgeReview(
      reviewerContext(),
      firstReview.id,
      META,
      db,
    );
    await approveAndPublishKnowledgeReview(
      reviewerContext(),
      firstReview.id,
      META,
      db,
    );
    assert.equal(
      (
        await db
          .select()
          .from(schema.knowledgeArticlePublications)
          .where(eq(schema.knowledgeArticlePublications.reviewRequestId, firstReview.id))
      ).length,
      1,
    );
    const published = await getKnowledgeArticle(
      contributorContext(),
      v1.id,
      db,
    );
    assert.equal(published.publishedVersionNumber, 1);

    const v2 = await updateKnowledgeArticle(
      contributorContext(),
      v1.id,
      {
        title: "Working v2",
        categoryId: category.id,
        summary: "v2 summary",
        body: "v2 body",
        visibility: "team",
        expectedUpdatedAt: published.updatedAt,
      },
      META,
      db,
    );
    assert.equal(v2.currentVersionNumber, 2);
    assert.equal(
      (await listKnowledgeArticles(viewerContext(), {}, db)).find(
        (article) => article.id === v1.id,
      )?.title,
      "Published v1",
    );
    assert.equal(
      (await getKnowledgeArticle(viewerContext(), v1.id, db)).body,
      "v1 body",
    );

    const secondReview = await submitKnowledgeReview(
      contributorContext(),
      { articleId: v1.id },
      META,
      db,
    );
    await assertError(
      () =>
        updateKnowledgeArticle(
          contributorContext(),
          v1.id,
          {
            title: "Blocked",
            categoryId: category.id,
            body: "Blocked",
            expectedUpdatedAt: v2.updatedAt,
          },
          META,
          db,
        ),
      "KNOWLEDGE_ARTICLE_NOT_EDITABLE",
    );
    await requestKnowledgeReviewChanges(
      reviewerContext(),
      secondReview.id,
      "请补充流程细节",
      META,
      db,
    );
    assert.equal(
      (await getKnowledgeArticle(viewerContext(), v1.id, db)).body,
      "v1 body",
    );
    await updateKnowledgeArticle(
      contributorContext(),
      v1.id,
      {
        title: "Working v3",
        categoryId: category.id,
        body: "v3 body",
        expectedUpdatedAt: v2.updatedAt,
      },
      META,
      db,
    );
    const thirdReview = await submitKnowledgeReview(
      contributorContext(),
      { articleId: v1.id },
      META,
      db,
    );
    await approveAndPublishKnowledgeReview(
      reviewerContext(),
      thirdReview.id,
      META,
      db,
    );
    assert.equal(
      (await getKnowledgeArticle(viewerContext(), v1.id, db)).body,
      "v3 body",
    );
    const publishedV3 = await getKnowledgeArticle(
      contributorContext(),
      v1.id,
      db,
    );

    const v4 = await updateKnowledgeArticle(
      contributorContext(),
      v1.id,
      {
        title: "Working v4",
        categoryId: category.id,
        body: "v4 body",
        expectedUpdatedAt: publishedV3.updatedAt,
      },
      META,
      db,
    );
    const fourthReview = await submitKnowledgeReview(
      contributorContext(),
      { articleId: v1.id },
      META,
      db,
    );
    await requestKnowledgeReviewChanges(
      reviewerContext(),
      fourthReview.id,
      "请修正示例",
      META,
      db,
    );
    assert.equal(
      (await getKnowledgeArticle(viewerContext(), v1.id, db)).body,
      "v3 body",
    );
    assert.equal(v4.currentVersionNumber, 4);
  });

  it("blocks viewer submission and self approval, and withdrawal unlocks editing", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Package 4 permissions", description: null },
      META,
      db,
    );
    const article = await createKnowledgeArticle(
      contributorContext(),
      {
        title: "Permission article",
        categoryId: category.id,
        body: "Body",
        visibility: "team",
      },
      META,
      db,
    );
    await assertError(
      () =>
        submitKnowledgeReview(
          viewerContext(),
          { articleId: article.id },
          META,
          db,
        ),
      "KNOWLEDGE_REVIEW_ACCESS_DENIED",
    );
    const review = await submitKnowledgeReview(
      contributorContext(),
      { articleId: article.id },
      META,
      db,
    );
    await withdrawKnowledgeReview(
      contributorContext(),
      review.id,
      META,
      db,
    );
    const updated = await updateKnowledgeArticle(
      contributorContext(),
      article.id,
      {
        title: "Edited after withdrawal",
        categoryId: category.id,
        body: "Edited body",
        expectedUpdatedAt: article.updatedAt,
      },
      META,
      db,
    );
    assert.equal(updated.currentVersionNumber, 2);

    const adminArticle = await createKnowledgeArticle(
      adminContext(),
      {
        title: "Admin cannot self approve",
        categoryId: category.id,
        body: "Admin body",
        visibility: "team",
      },
      META,
      db,
    );
    const adminReview = await submitKnowledgeReview(
      adminContext(),
      { articleId: adminArticle.id },
      META,
      db,
    );
    await assertError(
      () =>
        approveAndPublishKnowledgeReview(
          adminContext(),
          adminReview.id,
          META,
          db,
        ),
      "KNOWLEDGE_REVIEW_SELF_APPROVAL",
    );

    await assertError(
      () =>
        createKnowledgeArticle(
          reviewerContext(),
          {
            title: "Reviewer cannot author articles",
            categoryId: category.id,
            body: "Reviewer body",
            visibility: "team",
          },
          META,
          db,
        ),
      "KNOWLEDGE_ROLE_REQUIRED",
    );
  });

  it("does not archive an article while a review is active", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Package 4 archive safety", description: null },
      META,
      db,
    );
    const article = await createKnowledgeArticle(
      contributorContext(),
      {
        title: "Archive safety",
        categoryId: category.id,
        body: "Body",
        visibility: "team",
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
    await assertError(
      () =>
        archiveKnowledgeArticle(
          adminContext(),
          article.id,
          article.updatedAt,
          META,
          db,
        ),
      "KNOWLEDGE_ARTICLE_NOT_EDITABLE",
    );
    await db
      .update(schema.knowledgeArticles)
      .set({ status: "archived", archivedAt: new Date().toISOString() })
      .where(eq(schema.knowledgeArticles.id, article.id));
    await assertError(
      () =>
        approveAndPublishKnowledgeReview(
          reviewerContext(),
          review.id,
          META,
          db,
        ),
      "KNOWLEDGE_REVIEW_CONFLICT",
    );
    assert.equal(
      (
        await db
          .select()
          .from(schema.knowledgeArticlePublications)
          .where(eq(schema.knowledgeArticlePublications.articleId, article.id))
      ).length,
      0,
    );
  });
});
