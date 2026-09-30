import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import type { User } from "../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import {
  materializeKnowledgeSegmentCandidatesForSource,
  listKnowledgeSegmentCandidates,
} from "@/lib/knowledge/knowledge-segment-candidate-service";
import {
  processKnowledgeSourceAnalysisRun,
  startKnowledgeSourceAnalysis,
  updateKnowledgeSourceSegmentStatus,
} from "@/lib/knowledge/smart-ingest-analysis-service";
import { createKnowledgePasteSource } from "@/lib/knowledge/source-service";
import { assertSourceLevelOrganizeAllowed } from "@/lib/knowledge/smart-ingest-source-scope";
import { loadSmartIngestSourceScope } from "@/lib/knowledge/smart-ingest-source-scope";

const META = { ipAddress: "127.0.0.1", userAgent: "segment-candidate-test" };

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let staffUser: User;

const contributorContext = () => ({
  sessionId: "candidate-test-session",
  user: staffUser,
  role: "contributor" as const,
});

async function cleanup(): Promise<void> {
  await db.delete(schema.knowledgeSourceSegmentCandidates);
  await db.delete(schema.knowledgeSourceSegments);
  await db.delete(schema.knowledgeSourceAnalysisRuns);
  await db.delete(schema.knowledgeSources);
}

async function analyzeThreeTopicSource(text: string) {
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
  return { source, runId: started.runId, segments };
}

describe("knowledge segment candidate persistence (2E-1)", () => {
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

  it("A: 1 confirmed segment → 1 candidate", async () => {
    const text = "单一主题内容\n\n汇丰香港账户说明";
    const { source, segments } = await analyzeThreeTopicSource(text);
    assert.equal(segments.length, 1);
    await updateKnowledgeSourceSegmentStatus(
      contributorContext(),
      source.id,
      segments[0]!.id,
      "confirmed",
      META,
      db,
    );
    const candidates = await listKnowledgeSegmentCandidates(
      contributorContext(),
      source.id,
      db,
    );
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.segmentId, segments[0]!.id);
    assert.equal(candidates[0]?.status, "pending");
  });

  it("B: 3 confirmed segments → 3 candidates", async () => {
    const text = `HSBC HK\n\nA\n\n---\n\nBOCHK HK\n\nB\n\n---\n\nChase PC\n\nC`;
    const { source, segments } = await analyzeThreeTopicSource(text);
    assert.equal(segments.length, 3);
    for (const segment of segments) {
      await updateKnowledgeSourceSegmentStatus(
        contributorContext(),
        source.id,
        segment.id,
        "confirmed",
        META,
        db,
      );
    }
    const candidates = await listKnowledgeSegmentCandidates(
      contributorContext(),
      source.id,
      db,
    );
    assert.equal(candidates.length, 3);
  });

  it("C: 2 confirmed + 1 rejected → 2 candidates", async () => {
    const text = `主题 A\n\nA\n\n---\n\n主题 B\n\nB\n\n---\n\n主题 C\n\nC`;
    const { source, segments } = await analyzeThreeTopicSource(text);
    await updateKnowledgeSourceSegmentStatus(
      contributorContext(),
      source.id,
      segments[0]!.id,
      "confirmed",
      META,
      db,
    );
    await updateKnowledgeSourceSegmentStatus(
      contributorContext(),
      source.id,
      segments[1]!.id,
      "rejected",
      META,
      db,
    );
    await updateKnowledgeSourceSegmentStatus(
      contributorContext(),
      source.id,
      segments[2]!.id,
      "confirmed",
      META,
      db,
    );
    const candidates = await listKnowledgeSegmentCandidates(
      contributorContext(),
      source.id,
      db,
    );
    assert.equal(candidates.length, 2);
  });

  it("D/E: proposed or rejected alone does not create candidates", async () => {
    const text = `主题 A\n\nA\n\n---\n\n主题 B\n\nB`;
    const { source, segments } = await analyzeThreeTopicSource(text);
    await updateKnowledgeSourceSegmentStatus(
      contributorContext(),
      source.id,
      segments[0]!.id,
      "rejected",
      META,
      db,
    );
    let candidates = await listKnowledgeSegmentCandidates(
      contributorContext(),
      source.id,
      db,
    );
    assert.equal(candidates.length, 0);
    await updateKnowledgeSourceSegmentStatus(
      contributorContext(),
      source.id,
      segments[1]!.id,
      "confirmed",
      META,
      db,
    );
    candidates = await listKnowledgeSegmentCandidates(
      contributorContext(),
      source.id,
      db,
    );
    assert.equal(candidates.length, 1);
  });

  it("G/H/I: materialize twice is idempotent with stable ids", async () => {
    const text = "主题\n\n内容";
    const { source, segments } = await analyzeThreeTopicSource(text);
    await updateKnowledgeSourceSegmentStatus(
      contributorContext(),
      source.id,
      segments[0]!.id,
      "confirmed",
      META,
      db,
    );
    const first = await materializeKnowledgeSegmentCandidatesForSource(
      contributorContext(),
      source.id,
      db,
    );
    const second = await materializeKnowledgeSegmentCandidatesForSource(
      contributorContext(),
      source.id,
      db,
    );
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(first[0]?.id, second[0]?.id);
    const rows = await db
      .select()
      .from(schema.knowledgeSourceSegmentCandidates)
      .where(eq(schema.knowledgeSourceSegmentCandidates.sourceId, source.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.segmentId, segments[0]!.id);
    assert.equal(rows[0]?.analysisRunId, segments[0]!.analysisRunId);
  });

  it("J/K: evidence remains on segment and is not mutated by candidate", async () => {
    const text = "主题\n\n不可变证据文字";
    const { source, segments } = await analyzeThreeTopicSource(text);
    const before = segments[0]!.evidenceText;
    await updateKnowledgeSourceSegmentStatus(
      contributorContext(),
      source.id,
      segments[0]!.id,
      "confirmed",
      META,
      db,
    );
    const candidates = await listKnowledgeSegmentCandidates(
      contributorContext(),
      source.id,
      db,
    );
    assert.equal(candidates[0]?.segmentEvidenceText, before);
    const after = (
      await db
        .select()
        .from(schema.knowledgeSourceSegments)
        .where(eq(schema.knowledgeSourceSegments.id, segments[0]!.id))
        .limit(1)
    )[0];
    assert.equal(after?.evidenceText, before);
  });

  it("re-analysis: supersede old candidates and create new ids", async () => {
    const text = `主题 A\n\nA\n\n---\n\n主题 B\n\nB`;
    const { source, segments, runId: firstRunId } = await analyzeThreeTopicSource(text);
    for (const segment of segments) {
      await updateKnowledgeSourceSegmentStatus(
        contributorContext(),
        source.id,
        segment.id,
        "confirmed",
        META,
        db,
      );
    }
    const firstCandidates = await listKnowledgeSegmentCandidates(
      contributorContext(),
      source.id,
      db,
    );
    assert.equal(firstCandidates.length, 2);
    const firstIds = firstCandidates.map((row) => row.id);

    const second = await startKnowledgeSourceAnalysis(
      contributorContext(),
      source.id,
      META,
      db,
    );
    assert.notEqual(second.runId, firstRunId);
    await processKnowledgeSourceAnalysisRun(second.runId, db);

    const supersededRows = await db
      .select()
      .from(schema.knowledgeSourceSegmentCandidates)
      .where(
        and(
          eq(schema.knowledgeSourceSegmentCandidates.sourceId, source.id),
          eq(schema.knowledgeSourceSegmentCandidates.status, "superseded"),
        ),
      );
    assert.equal(supersededRows.length, 2);
    assert.ok(supersededRows.every((row) => row.supersededByAnalysisRunId === second.runId));

    const allRows = await db
      .select()
      .from(schema.knowledgeSourceSegmentCandidates)
      .where(eq(schema.knowledgeSourceSegmentCandidates.sourceId, source.id));
    assert.equal(allRows.length, 2);

    const newSegments = await db
      .select()
      .from(schema.knowledgeSourceSegments)
      .where(eq(schema.knowledgeSourceSegments.analysisRunId, second.runId));
    for (const segment of newSegments) {
      await updateKnowledgeSourceSegmentStatus(
        contributorContext(),
        source.id,
        segment.id,
        "confirmed",
        META,
        db,
      );
    }
    const newCandidates = await listKnowledgeSegmentCandidates(
      contributorContext(),
      source.id,
      db,
    );
    assert.equal(newCandidates.length, 2);
    for (const id of firstIds) {
      assert.ok(!newCandidates.some((row) => row.id === id));
    }
  });

  it("multi-topic source-level organizer remains blocked with candidates present", async () => {
    const text = `主题 A\n\nA\n\n---\n\n主题 B\n\nB`;
    const { source, segments } = await analyzeThreeTopicSource(text);
    for (const segment of segments) {
      await updateKnowledgeSourceSegmentStatus(
        contributorContext(),
        source.id,
        segment.id,
        "confirmed",
        META,
        db,
      );
    }
    const scope = await loadSmartIngestSourceScope(
      source.id,
      "ready_for_review",
      db,
    );
    assert.equal(scope.blocksSourceLevelOrganize, true);
    assert.throws(() => assertSourceLevelOrganizeAllowed(scope));
  });
});
