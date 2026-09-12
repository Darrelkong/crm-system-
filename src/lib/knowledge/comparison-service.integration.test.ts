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
  getKnowledgeArticle,
  updateKnowledgeArticle,
} from "@/lib/knowledge/core-service";
import {
  approveAndPublishKnowledgeReview,
  submitKnowledgeReview,
} from "@/lib/knowledge/review-service";
import { organizeKnowledgeSource } from "@/lib/knowledge/ai-organizer-service";
import {
  compareKnowledgeSource,
  getLatestKnowledgeComparison,
} from "@/lib/knowledge/comparison-service";
import {
  createKnowledgePasteSource,
  getKnowledgeSource,
  requireManageableKnowledgeSource,
} from "@/lib/knowledge/source-service";
import { retrieveComparisonCandidates } from "@/lib/knowledge/comparison-candidate-retrieval";
import { parseKnowledgeAiComparisonOutput } from "@/lib/knowledge/ai-comparison-schema";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import type { KnowledgeAiComparisonOutput } from "@/lib/knowledge/ai-comparison-schema";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";

const META = { ipAddress: null, userAgent: "knowledge-comparison-test" };
let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let adminUser: User;
let contributorUser: User;
let reviewerUser: User;
let ownerUser: User;

const adminContext = () => ({
  user: adminUser,
  sessionId: "comparison-admin",
  role: "knowledge_admin" as const,
});
const contributorContext = () => ({
  user: contributorUser,
  sessionId: "comparison-contributor",
  role: "contributor" as const,
});
const reviewerContext = () => ({
  user: reviewerUser,
  sessionId: "comparison-reviewer",
  role: "reviewer" as const,
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

async function publishArticle(
  articleId: string,
  actor: KnowledgeSessionContext = contributorContext(),
) {
  const review = await submitKnowledgeReview(actor, { articleId }, META, db);
  await approveAndPublishKnowledgeReview(
    reviewerContext(),
    review.id,
    META,
    db,
  );
}

async function createPublishedArticle(input: {
  title: string;
  body: string;
  visibility?: "team" | "owner" | "restricted";
  categoryName: string;
  actor?: KnowledgeSessionContext;
  forcePublish?: boolean;
}) {
  const actor = input.actor ?? contributorContext();
  const category = await createKnowledgeCategory(
    adminContext(),
    { name: input.categoryName, description: null },
    META,
    db,
  );
  const article = await createKnowledgeArticle(
    actor,
    {
      title: input.title,
      categoryId: category.id,
      body: input.body,
      visibility: input.visibility ?? "team",
    },
    META,
    db,
  );
  if (input.forcePublish) {
    await db
      .update(schema.knowledgeArticles)
      .set({ status: "published", publishedVersionNumber: 1 })
      .where(eq(schema.knowledgeArticles.id, article.id));
  } else {
    await publishArticle(article.id, actor);
  }
  const version = (
    await db
      .select()
      .from(schema.knowledgeArticleVersions)
      .where(eq(schema.knowledgeArticleVersions.articleId, article.id))
      .limit(1)
  )[0];
  return { article, version, category };
}

async function createOrganizedSource(input: {
  title?: string;
  rawText: string;
  actor?: KnowledgeSessionContext;
}) {
  const source = await createKnowledgePasteSource(
    input.actor ?? contributorContext(),
    {
      sourceTitle: input.title ?? "测试来源",
      rawText: input.rawText,
    },
    META,
    db,
  );
  await organizeKnowledgeSource(
    input.actor ?? contributorContext(),
    source.id,
    META,
    db,
  );
  return getKnowledgeSource(
    input.actor ?? contributorContext(),
    source.id,
    db,
  );
}

function validComparisonOutput(
  overrides: Partial<KnowledgeAiComparisonOutput> = {},
): KnowledgeAiComparisonOutput {
  return {
    relationship: "update_existing",
    matchedCandidateKey: "C1",
    matchConfidence: 0.91,
    newFacts: [
      {
        id: "nf-1",
        topic: "新增条款",
        existingValue: null,
        incomingValue: "新增内容",
        explanation: "来源新增信息",
        confidence: 0.8,
        sourceExcerpt: "新增内容",
        existingExcerpt: null,
      },
    ],
    changedFacts: [
      {
        id: "cf-1",
        topic: "最低资产",
        existingValue: "50 万",
        incomingValue: "100 万",
        explanation: "金额发生变化",
        confidence: 0.9,
        sourceExcerpt: "100 万",
        existingExcerpt: "50 万",
      },
    ],
    conflicts: [
      {
        id: "conf-1",
        topic: "审批时效",
        existingValue: "3 个工作日",
        incomingValue: "当日完成",
        explanation: "双方表述互相矛盾",
        confidence: 0.85,
        sourceExcerpt: "当日完成",
        existingExcerpt: "3 个工作日",
      },
    ],
    uncertainties: [
      {
        id: "u-1",
        topic: "最低资产",
        existingValue: "50 万",
        incomingValue: "可能 50 万，也可能 100 万，以经理确认为准",
        explanation: "来源本身不确定",
        confidence: 0.7,
        sourceExcerpt: "可能 50 万",
        existingExcerpt: null,
      },
    ],
    suggestedUpdates: [
      {
        topic: "资产要求",
        suggestion: "确认生效时间后更新资产要求",
        rationale: "金额变化需要人工确认",
        confidence: 0.86,
      },
    ],
    ...overrides,
  };
}

describe("Knowledge comparison service", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    adminUser = (
      await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.admin)).limit(1)
    )[0] as User;
    contributorUser = (
      await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffA)).limit(1)
    )[0] as User;
    reviewerUser = (
      await db.select().from(schema.users).where(eq(schema.users.id, SEED_IDS.staffB)).limit(1)
    )[0] as User;
    ownerUser = reviewerUser;
    await cleanup();
    await setRole(contributorUser.id, "contributor");
    await setRole(reviewerUser.id, "reviewer");
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("completes no_match with zero compare AI calls when no published knowledge exists", async () => {
    let providerCalls = 0;
    const source = await createOrganizedSource({
      rawText: "没有任何已发布知识的来源内容。",
    });
    const comparison = await compareKnowledgeSource(
      contributorContext(),
      source.id,
      META,
      db,
      {
        providerCall: async () => {
          providerCalls += 1;
          return validComparisonOutput();
        },
      },
    );
    assert.equal(comparison.status, "completed");
    assert.equal(comparison.relationship, "no_match");
    assert.equal(comparison.provider, null);
    assert.equal(comparison.model, null);
    assert.equal(comparison.candidateSnapshot.length, 0);
    assert.equal(comparison.comparison?.relationship, "no_match");
    assert.equal(providerCalls, 0);
  });

  it("retrieves obvious match and pins published version", async () => {
    const published = await createPublishedArticle({
      title: "汇丰香港开户要求",
      body: "最低资产 50 万。",
      categoryName: "海外银行",
    });
    const source = await createOrganizedSource({
      title: "汇丰香港开户更新",
      rawText: "汇丰香港开户要求更新，最低资产 100 万。",
    });
    const candidates = await retrieveComparisonCandidates(
      contributorContext(),
      {
        sourceTitle: source.sourceTitle,
        rawText: source.rawText ?? "",
        proposedTitle: source.organization?.proposedTitle ?? null,
        proposedSummary: source.organization?.proposedSummary ?? null,
        proposedCategory: source.organization?.proposedCategory ?? null,
        proposedBody: source.organization?.proposedBody ?? null,
      },
      db,
    );
    assert.equal(candidates[0]?.articleId, published.article.id);
    assert.equal(candidates[0]?.versionNumber, 1);
    assert.equal(candidates[0]?.articleVersionId, published.version?.id);
  });

  it("uses published snapshot when newer draft exists", async () => {
    const published = await createPublishedArticle({
      title: "版本钉扎测试",
      body: "Published phrase alpha only.",
      categoryName: "版本测试",
    });
    const current = await getKnowledgeArticle(
      contributorContext(),
      published.article.id,
      db,
    );
    await updateKnowledgeArticle(
      contributorContext(),
      published.article.id,
      {
        title: "版本钉扎测试草稿",
        categoryId: published.category.id,
        body: "Unpublished secret phrase beta.",
        visibility: "team",
        expectedUpdatedAt: current.updatedAt,
      },
      META,
      db,
    );
    const source = await createOrganizedSource({
      rawText: "版本钉扎测试 Published phrase alpha only.",
    });
    const candidates = await retrieveComparisonCandidates(
      contributorContext(),
      {
        sourceTitle: source.sourceTitle,
        rawText: source.rawText ?? "",
        proposedTitle: source.organization?.proposedTitle ?? null,
        proposedSummary: source.organization?.proposedSummary ?? null,
        proposedCategory: source.organization?.proposedCategory ?? null,
        proposedBody: source.organization?.proposedBody ?? null,
      },
      db,
    );
    assert.equal(candidates[0]?.versionNumber, 1);
    assert.equal(candidates[0]?.articleVersionId, published.version?.id);
  });

  it("excludes archived and inaccessible owner articles", async () => {
    await setRole(ownerUser.id, "contributor");
    const ownerArticle = await createPublishedArticle({
      title: "Owner only article",
      body: "Owner secret phrase.",
      visibility: "owner",
      categoryName: "Owner visibility",
      actor: {
        user: ownerUser,
        sessionId: "comparison-owner",
        role: "contributor" as KnowledgeRole,
      },
      forcePublish: true,
    });
    const archivedArticle = await createPublishedArticle({
      title: "Archived article",
      body: "Archived phrase.",
      categoryName: "Archive visibility",
    });
    await db
      .update(schema.knowledgeArticles)
      .set({ status: "archived", archivedAt: new Date().toISOString() })
      .where(eq(schema.knowledgeArticles.id, archivedArticle.article.id));

    const source = await createOrganizedSource({
      rawText: "Owner secret phrase Archived phrase",
    });
    const candidates = await retrieveComparisonCandidates(
      contributorContext(),
      {
        sourceTitle: source.sourceTitle,
        rawText: source.rawText ?? "",
        proposedTitle: source.organization?.proposedTitle ?? null,
        proposedSummary: source.organization?.proposedSummary ?? null,
        proposedCategory: source.organization?.proposedCategory ?? null,
        proposedBody: source.organization?.proposedBody ?? null,
      },
      db,
    );
    assert.equal(
      candidates.some((candidate) => candidate.articleId === ownerArticle.article.id),
      false,
    );
    assert.equal(
      candidates.some((candidate) => candidate.articleId === archivedArticle.article.id),
      false,
    );
  });

  it("allows knowledge_admin to see restricted published articles in retrieval", async () => {
    const restricted = await createPublishedArticle({
      title: "Restricted policy",
      body: "Restricted phrase gamma.",
      visibility: "restricted",
      categoryName: "Restricted visibility",
      actor: adminContext(),
      forcePublish: true,
    });
    const source = await createOrganizedSource({
      rawText: "Restricted phrase gamma",
      actor: adminContext(),
    });
    const candidates = await retrieveComparisonCandidates(
      adminContext(),
      {
        sourceTitle: source.sourceTitle,
        rawText: source.rawText ?? "",
        proposedTitle: source.organization?.proposedTitle ?? null,
        proposedSummary: source.organization?.proposedSummary ?? null,
        proposedCategory: source.organization?.proposedCategory ?? null,
        proposedBody: source.organization?.proposedBody ?? null,
      },
      db,
    );
    assert.equal(candidates[0]?.articleId, restricted.article.id);
  });

  it("stores structured comparison output and keeps organizer completed on compare failure", async () => {
    await createPublishedArticle({
      title: "比对成功文章",
      body: "比对成功 phrase",
      categoryName: "比对分类",
    });
    const source = await createOrganizedSource({
      rawText: "比对成功 phrase 更新内容",
    });
    const comparison = await compareKnowledgeSource(
      contributorContext(),
      source.id,
      META,
      db,
      {
        providerCall: async () => validComparisonOutput(),
      },
    );
    assert.equal(comparison.status, "completed");
    assert.equal(comparison.relationship, "update_existing");
    assert.equal(comparison.comparison?.changedFacts[0]?.incomingValue, "100 万");
    assert.equal(comparison.comparison?.uncertainties[0]?.incomingValue, "可能 50 万，也可能 100 万，以经理确认为准");
    const refreshed = await getKnowledgeSource(
      contributorContext(),
      source.id,
      db,
    );
    assert.equal(refreshed.status, "organized");
    assert.equal(refreshed.organization?.status, "completed");
  });

  it("rejects invalid candidate keys from provider output", async () => {
    const published = await createPublishedArticle({
      title: "无效候选键测试",
      body: "无效候选键 phrase",
      categoryName: "无效候选键",
    });
    const source = await createOrganizedSource({
      rawText: "无效候选键 phrase",
    });
    const injectedCandidate = {
      candidateKey: "C1",
      articleId: published.article.id,
      articleVersionId: published.version!.id,
      versionNumber: 1,
      title: published.article.title,
      summary: null,
      categoryName: published.category.name,
      visibility: "team" as const,
      bodyExcerpt: published.article.body,
      bodyExcerptStart: 0,
      bodyExcerptEnd: published.article.body.length,
      preRank: 1,
      preScore: 5,
      postRank: 1,
      postScore: 10,
      combinedScore: 15,
    };

    await assert.rejects(
      () =>
        compareKnowledgeSource(
          contributorContext(),
          source.id,
          META,
          db,
          {
            candidates: [injectedCandidate],
            providerCall: async () =>
              validComparisonOutput({ matchedCandidateKey: "C2" }),
          },
        ),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(
          error.errorCode,
          "AI_COMPARISON_CANDIDATE_INVALID",
        );
        return true;
      },
    );

    const latest = await getLatestKnowledgeComparison(
      contributorContext(),
      source.id,
      db,
    );
    assert.equal(latest?.status, "failed");
    assert.equal(latest?.failureCode, "AI_COMPARISON_CANDIDATE_INVALID");
    const refreshed = await getKnowledgeSource(
      contributorContext(),
      source.id,
      db,
    );
    assert.equal(refreshed.status, "organized");
    assert.equal(
      (
        await db
          .select()
          .from(schema.knowledgeArticles)
          .where(eq(schema.knowledgeArticles.id, published.article.id))
          .limit(1)
      )[0]?.body,
      "无效候选键 phrase",
    );
  });

  it("fails safely on malformed provider JSON without mutating articles", async () => {
    await createPublishedArticle({
      title: "畸形 JSON 测试",
      body: "畸形 JSON phrase",
      categoryName: "畸形 JSON",
    });
    const source = await createOrganizedSource({
      rawText: "畸形 JSON phrase",
    });
    await assert.rejects(
      () =>
        compareKnowledgeSource(
          contributorContext(),
          source.id,
          META,
          db,
          {
            providerCall: async () => ({ relationship: "broken" }),
          },
        ),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.errorCode, "AI_COMPARISON_OUTPUT_INVALID");
        return true;
      },
    );
  });

  it("creates immutable historical runs on rerun", async () => {
    await createPublishedArticle({
      title: "重新比对文章",
      body: "重新比对 phrase",
      categoryName: "重新比对",
    });
    const source = await createOrganizedSource({
      rawText: "重新比对 phrase",
    });
    const first = await compareKnowledgeSource(
      contributorContext(),
      source.id,
      META,
      db,
      { providerCall: async () => validComparisonOutput() },
    );
    const second = await compareKnowledgeSource(
      contributorContext(),
      source.id,
      META,
      db,
      { providerCall: async () => validComparisonOutput() },
    );
    assert.notEqual(first.id, second.id);
    const runs = await db
      .select()
      .from(schema.knowledgeAiComparisonRuns)
      .where(eq(schema.knowledgeAiComparisonRuns.sourceId, source.id));
    assert.equal(runs.length, 2);
  });

  it("validates schema semantics for changed fact vs uncertainty", () => {
    const changed = parseKnowledgeAiComparisonOutput(
      validComparisonOutput({
        uncertainties: [],
      }),
    );
    assert.equal(changed.success, true);
    if (!changed.success) throw new Error("expected success");
    assert.equal(changed.data.changedFacts[0]?.incomingValue, "100 万");
    assert.match(
      validComparisonOutput().uncertainties[0]?.incomingValue ?? "",
      /可能 50 万/,
    );
    assert.doesNotMatch(
      validComparisonOutput().uncertainties[0]?.incomingValue ?? "",
      /75 万/,
    );
  });
});
