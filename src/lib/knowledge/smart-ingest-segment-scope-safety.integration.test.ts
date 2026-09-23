import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { organizeKnowledgeSource } from "@/lib/knowledge/ai-organizer-service";
import { compareKnowledgeSource } from "@/lib/knowledge/comparison-service";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import {
  processKnowledgeSourceAnalysisRun,
  startKnowledgeSourceAnalysis,
} from "@/lib/knowledge/smart-ingest-analysis-service";
import {
  createKnowledgePasteSource,
  getKnowledgeSource,
} from "@/lib/knowledge/source-service";

const META = { ipAddress: null, userAgent: "smart-ingest-scope-safety-test" };

const THREE_TOPICS = `香港汇丰银行账户

一、资料要求
1. 身份证
2. 护照

---

香港中银银行账户

一、资料要求
1. 身份证
2. 护照

---

Chase Private Client

一、资料要求
ACH 日额度 10 万美元
Zelle 每日 15,000 美元`;

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let staffUser: User;

const contributorContext = () => ({
  user: staffUser,
  sessionId: "scope-safety-staff-session",
  role: "contributor" as const,
});

async function cleanup() {
  await db.delete(schema.knowledgeAiComparisonRuns);
  await db.delete(schema.knowledgeAiOrganizationRuns);
  await db.delete(schema.knowledgeSourceSegments);
  await db.delete(schema.knowledgeSourceAnalysisRuns);
  await db.delete(schema.knowledgeSources);
  await db.delete(schema.auditLogs).where(like(schema.auditLogs.action, "knowledge_%"));
}

async function analyzeThreeTopicSource(sourceId: string) {
  const started = await startKnowledgeSourceAnalysis(
    contributorContext(),
    sourceId,
    META,
    db,
  );
  await processKnowledgeSourceAnalysisRun(started.runId, db);
  return started.runId;
}

describe("smart ingest segment scope safety integration", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
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

  beforeEach(async () => {
    await cleanup();
  });

  it("D: source-level organize rejected for three retained segments", async () => {
    const source = await createKnowledgePasteSource(
      contributorContext(),
      { rawText: THREE_TOPICS },
      META,
      db,
    );
    await analyzeThreeTopicSource(source.id);
    const detail = await getKnowledgeSource(contributorContext(), source.id, db);
    assert.equal(detail.analysisStatus, "ready_for_review");
    assert.equal(detail.smartIngestScope.retainedProposedSegmentCount, 3);
    assert.equal(detail.smartIngestScope.blocksSourceLevelOrganize, true);

    await assert.rejects(
      () => organizeKnowledgeSource(contributorContext(), source.id, META, db),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(
          error.errorCode,
          KNOWLEDGE_ERROR_CODES.SMART_INGEST_SEGMENT_SCOPE_REQUIRED,
        );
        return true;
      },
    );
  });

  it("B: source-level compare rejected for three retained segments", async () => {
    const source = await createKnowledgePasteSource(
      contributorContext(),
      { rawText: THREE_TOPICS },
      META,
      db,
    );
    await analyzeThreeTopicSource(source.id);
    await db
      .update(schema.knowledgeSources)
      .set({ status: "organized" })
      .where(eq(schema.knowledgeSources.id, source.id));

    await assert.rejects(
      () => compareKnowledgeSource(contributorContext(), source.id, META, db),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(
          error.errorCode,
          KNOWLEDGE_ERROR_CODES.SMART_INGEST_SEGMENT_SCOPE_REQUIRED,
        );
        return true;
      },
    );
  });

  it("E: legacy paste without analysis still organizes", async () => {
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
    assert.equal(organized.organization?.status, "completed");
  });

  it("I: three-topic segmentation still yields three proposed segments", async () => {
    const source = await createKnowledgePasteSource(
      contributorContext(),
      { rawText: THREE_TOPICS },
      META,
      db,
    );
    const runId = await analyzeThreeTopicSource(source.id);
    const segments = await db
      .select()
      .from(schema.knowledgeSourceSegments)
      .where(eq(schema.knowledgeSourceSegments.analysisRunId, runId));
    assert.equal(segments.length, 3);
    assert.ok(segments.every((row) => row.status === "proposed"));
  });

  it("F: single-segment analyzed source organizes using segment evidence", async () => {
    const single = `Chase Private Client\n\nACH 日额度 10 万美元\nZelle 每日 15,000 美元`;
    const source = await createKnowledgePasteSource(
      contributorContext(),
      { rawText: single },
      META,
      db,
    );
    await analyzeThreeTopicSource(source.id);
    const organized = await organizeKnowledgeSource(
      contributorContext(),
      source.id,
      META,
      db,
    );
    assert.match(organized.organization?.proposedTitle ?? "", /Chase/i);
    assert.doesNotMatch(organized.organization?.proposedBody ?? "", /香港中银/);
  });

  it("H: HSBC → Chase stale-state regression still passes", async () => {
    const hsbc = `香港汇丰银行账户\n\n开户资料说明。`;
    const source = await createKnowledgePasteSource(
      contributorContext(),
      { rawText: hsbc },
      META,
      db,
    );
    const hsbcOrganized = await organizeKnowledgeSource(
      contributorContext(),
      source.id,
      META,
      db,
    );
    assert.match(hsbcOrganized.organization?.proposedTitle ?? "", /汇丰/);

    await db
      .update(schema.knowledgeSources)
      .set({
        rawText: `Chase Private Client\n\nZelle 每日 15,000 美元`,
        analysisStatus: "none",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.knowledgeSources.id, source.id));

    const chaseOrganized = await organizeKnowledgeSource(
      contributorContext(),
      source.id,
      META,
      db,
    );
    assert.match(chaseOrganized.organization?.proposedTitle ?? "", /Chase/i);
    assert.doesNotMatch(chaseOrganized.organization?.proposedTitle ?? "", /汇丰/);
  });
});
