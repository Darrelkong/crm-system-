import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import {
  compareKnowledgeSegmentCandidate,
  getLatestKnowledgeSegmentCandidateComparison,
} from "@/lib/knowledge/comparison-service";
import { buildSegmentEvidencePreRetrievalQuery } from "@/lib/knowledge/comparison-candidate-retrieval";
import { convertKnowledgeSegmentCandidateToDraft } from "@/lib/knowledge/knowledge-segment-candidate-convert-service";
import {
  listKnowledgeSegmentCandidates,
  materializeKnowledgeSegmentCandidatesForSource,
} from "@/lib/knowledge/knowledge-segment-candidate-service";
import { organizeKnowledgeSegmentCandidate } from "@/lib/knowledge/knowledge-segment-candidate-organizer-service";
import {
  processKnowledgeSourceAnalysisRun,
  startKnowledgeSourceAnalysis,
  updateKnowledgeSourceSegmentStatus,
} from "@/lib/knowledge/smart-ingest-analysis-service";
import { createKnowledgePasteSource } from "@/lib/knowledge/source-service";

const META = { ipAddress: "127.0.0.1", userAgent: "candidate-compare-convert-test" };

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let staffUser: User;

const contributorContext = () => ({
  sessionId: "candidate-cc-test",
  user: staffUser,
  role: "contributor" as const,
});

async function cleanup(): Promise<void> {
  await db.delete(schema.knowledgeAiComparisonRuns);
  await db.delete(schema.knowledgeAiOrganizationRuns);
  await db
    .update(schema.knowledgeSourceSegmentCandidates)
    .set({ draftArticleId: null, convertedAt: null });
  await db.delete(schema.knowledgeArticleVersions);
  await db.delete(schema.knowledgeArticles);
  await db.delete(schema.knowledgeSourceSegmentCandidates);
  await db.delete(schema.knowledgeSourceSegments);
  await db.delete(schema.knowledgeSourceAnalysisRuns);
  await db.delete(schema.knowledgeSources);
}

describe("knowledge segment candidate compare + convert (2E-5/6)", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    staffUser = (
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, SEED_IDS.staffA))
        .limit(1)
    )[0] as User;
  });

  afterEach(async () => {
    await cleanup();
  });

  after(async () => {
    await cleanup();
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("uses segment evidence for pre-retrieval query, not full source text", () => {
    const query = buildSegmentEvidencePreRetrievalQuery({
      segmentTitleHint: "HSBC HK",
      evidenceText: "汇丰香港私人银行\n最低资产要求50万港币",
    });
    assert.match(query, /HSBC|汇丰/);
    assert.doesNotMatch(query, /Chase|大通/);
  });

  it("compares and converts one candidate without touching source linked_article_id", async () => {
    const text = `HSBC HK\n\n汇丰香港\n\n---\n\nChase PC\n\nChase details`;
    const source = await createKnowledgePasteSource(
      contributorContext(),
      { rawText: text },
      META,
      db,
    );
    const started = await startKnowledgeSourceAnalysis(
      contributorContext(),
      source.id,
      META,
      db,
    );
    await processKnowledgeSourceAnalysisRun(started.runId, db);
    const segments = await db
      .select()
      .from(schema.knowledgeSourceSegments)
      .where(eq(schema.knowledgeSourceSegments.analysisRunId, started.runId))
      .orderBy(schema.knowledgeSourceSegments.segmentIndex);
    await updateKnowledgeSourceSegmentStatus(
      contributorContext(),
      source.id,
      segments[0]!.id,
      "confirmed",
      META,
      db,
    );
    await materializeKnowledgeSegmentCandidatesForSource(
      contributorContext(),
      source.id,
      db,
    );
    const candidates = await listKnowledgeSegmentCandidates(
      contributorContext(),
      source.id,
      db,
    );
    const candidate = candidates[0]!;
    const categoryId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(schema.knowledgeCategories).values({
      id: categoryId,
      name: "测试分类",
      slug: `test-cat-${categoryId.slice(0, 8)}`,
      description: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .update(schema.knowledgeSourceSegmentCandidates)
      .set({ knowledgeCategoryId: categoryId })
      .where(eq(schema.knowledgeSourceSegmentCandidates.id, candidate.id));

    await organizeKnowledgeSegmentCandidate(
      contributorContext(),
      source.id,
      candidate.id,
      META,
      db,
    );

    const draft = {
      title: "汇丰香港账户",
      summary: "汇丰香港私人银行开户要求摘要。",
      body: "汇丰香港私人银行最低资产要求50万港币。",
    };

    const comparison = await compareKnowledgeSegmentCandidate(
      contributorContext(),
      source.id,
      candidate.id,
      draft,
      META,
      db,
      {
        providerCall: async () => ({
          relationship: "new_article",
          matchedCandidateKey: null,
          matchConfidence: 0.3,
          newFacts: [],
          changedFacts: [],
          conflicts: [],
          uncertainties: [],
          suggestedUpdates: [],
        }),
      },
    );
    assert.equal(comparison.candidateId, candidate.id);
    assert.equal(comparison.status, "completed");

    const latest = await getLatestKnowledgeSegmentCandidateComparison(
      contributorContext(),
      source.id,
      candidate.id,
      db,
    );
    assert.ok(latest?.comparison?.comparedOrganizerDraft);

    const article = await convertKnowledgeSegmentCandidateToDraft(
      contributorContext(),
      source.id,
      candidate.id,
      { ...draft, categoryId },
      META,
      db,
    );
    assert.ok(article.id);

    const articleAgain = await convertKnowledgeSegmentCandidateToDraft(
      contributorContext(),
      source.id,
      candidate.id,
      { ...draft, categoryId },
      META,
      db,
    );
    assert.equal(articleAgain.id, article.id);

    const sourceRow = (
      await db
        .select()
        .from(schema.knowledgeSources)
        .where(eq(schema.knowledgeSources.id, source.id))
        .limit(1)
    )[0]!;
    assert.equal(sourceRow.linkedArticleId, null);
  });
});
