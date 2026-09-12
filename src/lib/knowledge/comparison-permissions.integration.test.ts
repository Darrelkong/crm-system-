import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import {
  createKnowledgeArticle,
  createKnowledgeCategory,
} from "@/lib/knowledge/core-service";
import { organizeKnowledgeSource } from "@/lib/knowledge/ai-organizer-service";
import {
  compareKnowledgeSource,
  getLatestKnowledgeComparison,
} from "@/lib/knowledge/comparison-service";
import {
  createKnowledgePasteSource,
  requireManageableKnowledgeSource,
  requireViewableKnowledgeSource,
} from "@/lib/knowledge/source-service";
import type { KnowledgeAiComparisonOutput } from "@/lib/knowledge/ai-comparison-schema";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";

const META = { ipAddress: null, userAgent: "comparison-permissions-test" };
let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let contributorA: User;
let contributorB: User;
let reviewerUser: User;

const adminContext = () => ({
  user: adminUser,
  sessionId: "perm-admin",
  role: "knowledge_admin" as const,
});
const contributorAContext = () => ({
  user: contributorA,
  sessionId: "perm-contributor-a",
  role: "contributor" as const,
});
const contributorBContext = () => ({
  user: contributorB,
  sessionId: "perm-contributor-b",
  role: "contributor" as const,
});
const reviewerContext = () => ({
  user: reviewerUser,
  sessionId: "perm-reviewer",
  role: "reviewer" as const,
});
const viewerContext = () => ({
  user: contributorA,
  sessionId: "perm-viewer",
  role: "viewer" as const,
});

async function cleanup() {
  await db.delete(schema.knowledgeAiComparisonRuns);
  await db.delete(schema.knowledgeAiOrganizationRuns);
  await db.delete(schema.knowledgeSources);
  await db.delete(schema.knowledgeArticlePublications);
  await db.delete(schema.knowledgeReviewRequests);
  await db.delete(schema.knowledgeArticleVersions);
  await db.delete(schema.knowledgeArticles);
  await db.delete(schema.knowledgeCategories);
  await db
    .delete(schema.auditLogs)
    .where(like(schema.auditLogs.action, "knowledge_%"));
}

async function setRole(userId: string, role: "contributor" | "reviewer" | "viewer") {
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

async function withContributorBRole<T>(action: () => Promise<T>): Promise<T> {
  await setRole(contributorB.id, "contributor");
  try {
    return await action();
  } finally {
    await setRole(reviewerUser.id, "reviewer");
  }
}

async function createOrganizedSource(
  actor: ReturnType<typeof contributorAContext>,
  rawText: string,
) {
  const source = await createKnowledgePasteSource(
    actor,
    { sourceTitle: "权限测试来源", rawText },
    META,
    db,
  );
  await organizeKnowledgeSource(actor, source.id, META, db);
  return source.id;
}

function validComparisonOutput(): KnowledgeAiComparisonOutput {
  return {
    relationship: "update_existing",
    matchedCandidateKey: "C1",
    matchConfidence: 0.9,
    newFacts: [
      {
        id: "nf-1",
        topic: "资产要求",
        existingValue: "Owner secret 50 万",
        incomingValue: "100 万",
        explanation: "金额变化",
        confidence: 0.9,
        sourceExcerpt: "100 万",
        existingExcerpt: "Owner secret 50 万",
      },
    ],
    changedFacts: [],
    conflicts: [],
    uncertainties: [],
    suggestedUpdates: [],
  };
}

async function assertDenied(
  action: () => Promise<unknown>,
  code = "KNOWLEDGE_SOURCE_ACCESS_DENIED",
) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof KnowledgeServiceError);
    assert.equal(error.errorCode, code);
    return true;
  });
}

describe("Knowledge comparison permissions", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    adminUser = (
      await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.admin)).limit(1)
    )[0] as User;
    contributorA = (
      await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffA)).limit(1)
    )[0] as User;
    contributorB = (
      await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffB)).limit(1)
    )[0] as User;
    reviewerUser = contributorB;
    await cleanup();
    await setRole(contributorA.id, "contributor");
    await setRole(contributorB.id, "contributor");
    await setRole(reviewerUser.id, "reviewer");
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("A admin POST compare → allow", async () => {
    const sourceId = await createOrganizedSource(
      contributorAContext(),
      "admin post compare phrase",
    );
    const comparison = await compareKnowledgeSource(
      adminContext(),
      sourceId,
      META,
      db,
    );
    assert.equal(comparison.status, "completed");
  });

  it("B contributor own-source POST → allow", async () => {
    const sourceId = await createOrganizedSource(
      contributorAContext(),
      "own post compare phrase",
    );
    const comparison = await compareKnowledgeSource(
      contributorAContext(),
      sourceId,
      META,
      db,
    );
    assert.equal(comparison.status, "completed");
  });

  it("C contributor other-source POST → deny", async () => {
    const sourceId = await createOrganizedSource(
      contributorAContext(),
      "other post compare phrase",
    );
    await withContributorBRole(() =>
      assertDenied(() =>
        compareKnowledgeSource(contributorBContext(), sourceId, META, db),
      ),
    );
  });

  it("D reviewer POST → deny (no source management capability)", async () => {
    const sourceId = await createOrganizedSource(
      contributorAContext(),
      "reviewer post compare phrase",
    );
    await assertDenied(() =>
      compareKnowledgeSource(reviewerContext(), sourceId, META, db),
    );
  });

  it("E viewer POST → deny", async () => {
    const sourceId = await createOrganizedSource(
      contributorAContext(),
      "viewer post compare phrase",
    );
    await assertDenied(() =>
      compareKnowledgeSource(viewerContext(), sourceId, META, db),
    );
  });

  it("F admin GET → allow", async () => {
    const sourceId = await createOrganizedSource(
      contributorAContext(),
      "admin get compare phrase",
    );
    await compareKnowledgeSource(contributorAContext(), sourceId, META, db);
    const comparison = await getLatestKnowledgeComparison(
      adminContext(),
      sourceId,
      db,
    );
    assert.ok(comparison);
  });

  it("G contributor own-source GET → allow", async () => {
    const sourceId = await createOrganizedSource(
      contributorAContext(),
      "own get compare phrase",
    );
    await compareKnowledgeSource(contributorAContext(), sourceId, META, db);
    const comparison = await getLatestKnowledgeComparison(
      contributorAContext(),
      sourceId,
      db,
    );
    assert.ok(comparison);
  });

  it("H reviewer GET → allow via review read capability", async () => {
    const sourceId = await createOrganizedSource(
      contributorAContext(),
      "reviewer get compare phrase",
    );
    await compareKnowledgeSource(contributorAContext(), sourceId, META, db);
    const comparison = await getLatestKnowledgeComparison(
      reviewerContext(),
      sourceId,
      db,
    );
    assert.ok(comparison);
    await assert.doesNotReject(() =>
      requireViewableKnowledgeSource(reviewerContext(), sourceId, db),
    );
  });

  it("I unauthorized contributor GET → deny", async () => {
    const sourceId = await createOrganizedSource(
      contributorAContext(),
      "unauthorized get compare phrase",
    );
    await compareKnowledgeSource(contributorAContext(), sourceId, META, db);
    await withContributorBRole(() =>
      assertDenied(() =>
        getLatestKnowledgeComparison(contributorBContext(), sourceId, db),
      ),
    );
  });

  it("J viewer GET → deny (no source read path for viewer)", async () => {
    const sourceId = await createOrganizedSource(
      contributorAContext(),
      "viewer get compare phrase",
    );
    await compareKnowledgeSource(contributorAContext(), sourceId, META, db);
    await assertDenied(() =>
      getLatestKnowledgeComparison(viewerContext(), sourceId, db),
    );
  });

  it("K matched owner article cannot leak via comparison GET", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Owner leak category", description: null },
      META,
      db,
    );
    const ownerArticle = await createKnowledgeArticle(
      {
        user: reviewerUser,
        sessionId: "owner-article",
        role: "contributor",
      },
      {
        title: "Owner leak article",
        categoryId: category.id,
        body: "Owner secret 50 万",
        visibility: "owner",
      },
      META,
      db,
    );
    await db
      .update(schema.knowledgeArticles)
      .set({ status: "published", publishedVersionNumber: 1 })
      .where(eq(schema.knowledgeArticles.id, ownerArticle.id));
    const version = (
      await db
        .select()
        .from(schema.knowledgeArticleVersions)
        .where(eq(schema.knowledgeArticleVersions.articleId, ownerArticle.id))
        .limit(1)
    )[0]!;

    const sourceId = await createOrganizedSource(
      contributorAContext(),
      "Owner secret 50 万 incoming",
    );
    await compareKnowledgeSource(
      contributorAContext(),
      sourceId,
      META,
      db,
      {
        candidates: [
          {
            candidateKey: "C1",
            articleId: ownerArticle.id,
            articleVersionId: version.id,
            versionNumber: 1,
            title: "Owner leak article",
            summary: null,
            categoryName: category.name,
            visibility: "owner",
            bodyExcerpt: "Owner secret 50 万",
            bodyExcerptStart: 0,
            bodyExcerptEnd: 20,
            preRank: 1,
            preScore: 5,
            postRank: 1,
            postScore: 10,
            combinedScore: 15,
          },
        ],
        providerCall: async () => validComparisonOutput(),
      },
    );

    const comparison = await getLatestKnowledgeComparison(
      contributorAContext(),
      sourceId,
      db,
    );
    assert.equal(comparison?.matchedArticleId, null);
    assert.equal(comparison?.candidateSnapshot.length, 0);
    assert.equal(comparison?.comparison?.newFacts[0]?.existingValue, null);
    assert.equal(comparison?.comparison?.newFacts[0]?.existingExcerpt, null);
    assert.ok(
      comparison?.comparison?.newFacts[0]?.incomingValue?.includes("100 万"),
    );
  });

  it("L candidate_snapshot_json cannot leak inaccessible article metadata", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Snapshot leak category", description: null },
      META,
      db,
    );
    const ownerArticle = await createKnowledgeArticle(
      {
        user: reviewerUser,
        sessionId: "snapshot-owner",
        role: "contributor",
      },
      {
        title: "Snapshot restricted title",
        categoryId: category.id,
        body: "Restricted snapshot body",
        visibility: "owner",
      },
      META,
      db,
    );
    await db
      .update(schema.knowledgeArticles)
      .set({ status: "published", publishedVersionNumber: 1 })
      .where(eq(schema.knowledgeArticles.id, ownerArticle.id));
    const version = (
      await db
        .select()
        .from(schema.knowledgeArticleVersions)
        .where(eq(schema.knowledgeArticleVersions.articleId, ownerArticle.id))
        .limit(1)
    )[0]!;

    const sourceId = await createOrganizedSource(
      contributorAContext(),
      "snapshot restricted phrase",
    );
    await compareKnowledgeSource(
      contributorAContext(),
      sourceId,
      META,
      db,
      {
        candidates: [
          {
            candidateKey: "C1",
            articleId: ownerArticle.id,
            articleVersionId: version.id,
            versionNumber: 1,
            title: "Snapshot restricted title",
            summary: null,
            categoryName: category.name,
            visibility: "owner",
            bodyExcerpt: "Restricted snapshot body",
            bodyExcerptStart: 0,
            bodyExcerptEnd: 24,
            preRank: 1,
            preScore: 5,
            postRank: 1,
            postScore: 10,
            combinedScore: 15,
          },
        ],
        providerCall: async () => ({
          relationship: "new_article",
          matchedCandidateKey: null,
          matchConfidence: 0.2,
          newFacts: [],
          changedFacts: [],
          conflicts: [],
          uncertainties: [],
          suggestedUpdates: [],
        }),
      },
    );

    const comparison = await getLatestKnowledgeComparison(
      contributorAContext(),
      sourceId,
      db,
    );
    assert.equal(comparison?.candidateSnapshot.length, 0);
    const raw = (
      await db
        .select()
        .from(schema.knowledgeAiComparisonRuns)
        .where(eq(schema.knowledgeAiComparisonRuns.sourceId, sourceId))
        .limit(1)
    )[0]?.candidateSnapshotJson;
    assert.match(raw ?? "", /Snapshot restricted title/);
    assert.doesNotMatch(
      JSON.stringify(comparison?.candidateSnapshot ?? []),
      /Snapshot restricted title/,
    );
  });

  it("M comparison_json existingExcerpt cannot bypass article visibility", async () => {
    const sourceId = await createOrganizedSource(
      contributorAContext(),
      "existing excerpt leak phrase",
    );
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Excerpt leak category", description: null },
      META,
      db,
    );
    const ownerArticle = await createKnowledgeArticle(
      {
        user: reviewerUser,
        sessionId: "excerpt-owner",
        role: "contributor",
      },
      {
        title: "Excerpt leak article",
        categoryId: category.id,
        body: "Excerpt leak existing body",
        visibility: "owner",
      },
      META,
      db,
    );
    await db
      .update(schema.knowledgeArticles)
      .set({ status: "published", publishedVersionNumber: 1 })
      .where(eq(schema.knowledgeArticles.id, ownerArticle.id));
    const version = (
      await db
        .select()
        .from(schema.knowledgeArticleVersions)
        .where(eq(schema.knowledgeArticleVersions.articleId, ownerArticle.id))
        .limit(1)
    )[0]!;

    await compareKnowledgeSource(
      contributorAContext(),
      sourceId,
      META,
      db,
      {
        candidates: [
          {
            candidateKey: "C1",
            articleId: ownerArticle.id,
            articleVersionId: version.id,
            versionNumber: 1,
            title: "Excerpt leak article",
            summary: null,
            categoryName: category.name,
            visibility: "owner",
            bodyExcerpt: "Excerpt leak existing body",
            bodyExcerptStart: 0,
            bodyExcerptEnd: 26,
            preRank: 1,
            preScore: 5,
            postRank: 1,
            postScore: 10,
            combinedScore: 15,
          },
        ],
        providerCall: async () => validComparisonOutput(),
      },
    );

    const comparison = await getLatestKnowledgeComparison(
      contributorAContext(),
      sourceId,
      db,
    );
    assert.equal(comparison?.comparison?.newFacts[0]?.existingExcerpt, null);
    assert.equal(comparison?.comparison?.newFacts[0]?.existingValue, null);
  });

  it("separates POST manage guard from GET view guard", async () => {
    const sourceId = await createOrganizedSource(
      contributorAContext(),
      "guard separation phrase",
    );
    await assert.doesNotReject(() =>
      requireViewableKnowledgeSource(reviewerContext(), sourceId, db),
    );
    await assertDenied(() =>
      requireManageableKnowledgeSource(reviewerContext(), sourceId, db),
    );
  });
});
