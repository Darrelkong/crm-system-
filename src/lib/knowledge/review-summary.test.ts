import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import {
  createKnowledgeArticle,
  createKnowledgeCategory,
  getKnowledgeArticle,
  updateKnowledgeArticle,
} from "@/lib/knowledge/core-service";
import {
  approveAndPublishKnowledgeReview,
  getArticleReviewSummaryForViewer,
  isActiveArticleReviewForCurrentVersion,
  listKnowledgeReviewRequests,
  requestKnowledgeReviewChanges,
  submitKnowledgeReview,
  withdrawKnowledgeReview,
} from "@/lib/knowledge/review-service";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";

const META = { ipAddress: null, userAgent: "knowledge-review-summary-test" };
let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let contributorUser: User;
let reviewerUser: User;

const adminContext = () => ({
  user: adminUser,
  sessionId: "review-summary-admin",
  role: "knowledge_admin" as const,
});
const contributorContext = () => ({
  user: contributorUser,
  sessionId: "review-summary-contributor",
  role: "contributor" as const,
});
const reviewerContext = () => ({
  user: reviewerUser,
  sessionId: "review-summary-reviewer",
  role: "reviewer" as const,
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

describe("Knowledge current-version review summary selection", () => {
  it("treats only current-version pending/changes_requested reviews as active", () => {
    assert.equal(
      isActiveArticleReviewForCurrentVersion("changes_requested", 1, 1),
      true,
    );
    assert.equal(
      isActiveArticleReviewForCurrentVersion("changes_requested", 1, 2),
      false,
    );
    assert.equal(
      isActiveArticleReviewForCurrentVersion("pending", 3, 3),
      true,
    );
    assert.equal(
      isActiveArticleReviewForCurrentVersion("approved", 2, 2),
      false,
    );
  });
});

describe("Knowledge article review summary integration", () => {
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

  it("shows V1 changes_requested only while V1 is current", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Review summary", description: null },
      META,
      db,
    );
    const article = await createKnowledgeArticle(
      contributorContext(),
      {
        title: "Review summary article",
        categoryId: category.id,
        body: "v1 body",
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
    await requestKnowledgeReviewChanges(
      reviewerContext(),
      review.id,
      "revise v1",
      META,
      db,
    );
    const activeV1 = await getArticleReviewSummaryForViewer(
      contributorContext(),
      article.id,
      db,
    );
    assert.equal(activeV1?.status, "changes_requested");
    assert.equal(activeV1?.submittedVersionNumber, 1);
  });

  it("does not surface stale V1 changes_requested after newer versions publish", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Review summary stale", description: null },
      META,
      db,
    );
    const article = await createKnowledgeArticle(
      contributorContext(),
      {
        title: "Stale review article",
        categoryId: category.id,
        body: "v1 body",
        visibility: "team",
      },
      META,
      db,
    );
    const v1Review = await submitKnowledgeReview(
      contributorContext(),
      { articleId: article.id },
      META,
      db,
    );
    await requestKnowledgeReviewChanges(
      reviewerContext(),
      v1Review.id,
      "revise v1",
      META,
      db,
    );
    const current = await getKnowledgeArticle(
      contributorContext(),
      article.id,
      db,
    );
    await updateKnowledgeArticle(
      contributorContext(),
      article.id,
      {
        title: "Stale review article v2",
        categoryId: category.id,
        body: "v2 body",
        expectedUpdatedAt: current.updatedAt,
      },
      META,
      db,
    );
    const v2Review = await submitKnowledgeReview(
      contributorContext(),
      { articleId: article.id },
      META,
      db,
    );
    await approveAndPublishKnowledgeReview(
      reviewerContext(),
      v2Review.id,
      META,
      db,
    );
    const afterV2 = await getArticleReviewSummaryForViewer(
      contributorContext(),
      article.id,
      db,
    );
    assert.equal(afterV2, null);

    const publishedV2 = await getKnowledgeArticle(
      contributorContext(),
      article.id,
      db,
    );
    await updateKnowledgeArticle(
      contributorContext(),
      article.id,
      {
        title: "Stale review article v3",
        categoryId: category.id,
        body: "v3 body",
        expectedUpdatedAt: publishedV2.updatedAt,
      },
      META,
      db,
    );
    const v3Review = await submitKnowledgeReview(
      contributorContext(),
      { articleId: article.id },
      META,
      db,
    );
    await approveAndPublishKnowledgeReview(
      reviewerContext(),
      v3Review.id,
      META,
      db,
    );
    const afterV3 = await getArticleReviewSummaryForViewer(
      contributorContext(),
      article.id,
      db,
    );
    assert.equal(afterV3, null);
  });

  it("shows current-version pending and changes_requested reviews", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Review summary current", description: null },
      META,
      db,
    );
    const article = await createKnowledgeArticle(
      contributorContext(),
      {
        title: "Current review article",
        categoryId: category.id,
        body: "v1 body",
        visibility: "team",
      },
      META,
      db,
    );
    const v1Review = await submitKnowledgeReview(
      contributorContext(),
      { articleId: article.id },
      META,
      db,
    );
    await approveAndPublishKnowledgeReview(
      reviewerContext(),
      v1Review.id,
      META,
      db,
    );
    const published = await getKnowledgeArticle(
      contributorContext(),
      article.id,
      db,
    );
    await updateKnowledgeArticle(
      contributorContext(),
      article.id,
      {
        title: "Current review article v2",
        categoryId: category.id,
        body: "v2 body",
        expectedUpdatedAt: published.updatedAt,
      },
      META,
      db,
    );
    const pendingReview = await submitKnowledgeReview(
      contributorContext(),
      { articleId: article.id },
      META,
      db,
    );
    const pendingSummary = await getArticleReviewSummaryForViewer(
      contributorContext(),
      article.id,
      db,
    );
    assert.equal(pendingSummary?.status, "pending");
    assert.equal(pendingSummary?.submittedVersionNumber, 2);
    await withdrawKnowledgeReview(
      contributorContext(),
      pendingReview.id,
      META,
      db,
    );
    const v2Review = await submitKnowledgeReview(
      contributorContext(),
      { articleId: article.id },
      META,
      db,
    );
    await requestKnowledgeReviewChanges(
      reviewerContext(),
      v2Review.id,
      "revise v2",
      META,
      db,
    );
    const changesRequestedSummary = await getArticleReviewSummaryForViewer(
      contributorContext(),
      article.id,
      db,
    );
    assert.equal(changesRequestedSummary?.status, "changes_requested");
    assert.equal(changesRequestedSummary?.submittedVersionNumber, 2);
  });

  it("keeps historical review records in review center history", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Review summary history", description: null },
      META,
      db,
    );
    const article = await createKnowledgeArticle(
      contributorContext(),
      {
        title: "History review article",
        categoryId: category.id,
        body: "v1 body",
        visibility: "team",
      },
      META,
      db,
    );
    const v1Review = await submitKnowledgeReview(
      contributorContext(),
      { articleId: article.id },
      META,
      db,
    );
    await requestKnowledgeReviewChanges(
      reviewerContext(),
      v1Review.id,
      "revise v1",
      META,
      db,
    );
    const current = await getKnowledgeArticle(
      contributorContext(),
      article.id,
      db,
    );
    await updateKnowledgeArticle(
      contributorContext(),
      article.id,
      {
        title: "History review article v2",
        categoryId: category.id,
        body: "v2 body",
        expectedUpdatedAt: current.updatedAt,
      },
      META,
      db,
    );
    const v2Review = await submitKnowledgeReview(
      contributorContext(),
      { articleId: article.id },
      META,
      db,
    );
    await approveAndPublishKnowledgeReview(
      reviewerContext(),
      v2Review.id,
      META,
      db,
    );
    const history = await listKnowledgeReviewRequests(
      contributorContext(),
      "history",
      db,
    );
    const articleHistory = history.filter((item) => item.articleId === article.id);
    assert.ok(
      articleHistory.some(
        (item) =>
          item.submittedVersionNumber === 1 &&
          item.status === "changes_requested",
      ),
    );
    assert.ok(
      articleHistory.some(
        (item) => item.submittedVersionNumber === 2 && item.status === "approved",
      ),
    );
  });
});
