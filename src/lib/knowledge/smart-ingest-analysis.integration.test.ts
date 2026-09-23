import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  processKnowledgeSourceAnalysisRun,
  startKnowledgeSourceAnalysis,
} from "@/lib/knowledge/smart-ingest-analysis-service";
import { createKnowledgePasteSource } from "@/lib/knowledge/source-service";
const META = { ipAddress: "127.0.0.1", userAgent: "test" };
const d1HarnessReady = Boolean(
  process.env.CRM_TEST_D1_HTTP_URL && process.env.CRM_TEST_D1_HTTP_TOKEN,
);

function contributorContext(userId: string) {
  return {
    sessionId: "test-session",
    user: { id: userId, role: "staff" },
    role: "contributor" as const,
    access: { initialized: true, unlocked: true },
  } as never;
}

describe("smart ingest analysis integration", () => {
  let db: ReturnType<typeof getDb>;
  let userId: string;

  before(async () => {
    if (!d1HarnessReady) return;
    db = getDb();
    userId = (
      await db.select({ id: schema.users.id }).from(schema.users).limit(1)
    )[0]?.id!;
    assert.ok(userId);
  });

  it("H: re-analysis supersedes prior proposed segments", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const text = `主题 A\n\n内容 A\n\n---\n\n主题 B\n\n内容 B`;
    const source = await createKnowledgePasteSource(
      contributorContext(userId),
      { rawText: text },
      META,
      db,
    );
    const first = await startKnowledgeSourceAnalysis(
      contributorContext(userId),
      source.id,
      META,
      db,
    );
    await processKnowledgeSourceAnalysisRun(first.runId, db);
    const firstSegments = await db
      .select()
      .from(schema.knowledgeSourceSegments)
      .where(eq(schema.knowledgeSourceSegments.analysisRunId, first.runId));
    assert.equal(firstSegments.length, 2);

    const second = await startKnowledgeSourceAnalysis(
      contributorContext(userId),
      source.id,
      META,
      db,
    );
    await processKnowledgeSourceAnalysisRun(second.runId, db);
    const superseded = await db
      .select()
      .from(schema.knowledgeSourceSegments)
      .where(eq(schema.knowledgeSourceSegments.analysisRunId, first.runId));
    assert.ok(superseded.every((row) => row.status === "superseded"));
    const active = await db
      .select()
      .from(schema.knowledgeSourceSegments)
      .where(eq(schema.knowledgeSourceSegments.analysisRunId, second.runId));
    assert.equal(active.length, 2);
    assert.ok(active.every((row) => row.status === "proposed"));
  });

  it("J: rejects file source for smart ingest analyze", async (t) => {
    if (!d1HarnessReady) {
      t.skip("D1 harness not available");
      return;
    }
    const now = new Date().toISOString();
    const sourceId = crypto.randomUUID();
    await db.insert(schema.knowledgeSources).values({
      id: sourceId,
      sourceType: "file",
      sourceTitle: "file",
      originalFilename: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      rawText: "pdf text",
      storageKey: "key",
      contentHash: `hash-${sourceId}`,
      status: "ready",
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
      processedAt: now,
      failureCode: null,
      linkedArticleId: null,
      analysisStatus: "none",
    });
    await assert.rejects(
      () =>
        startKnowledgeSourceAnalysis(
          contributorContext(userId),
          sourceId,
          META,
          db,
        ),
      (error: unknown) => {
        assert.equal((error as { errorCode?: string }).errorCode, "UNSUPPORTED_SOURCE_TYPE");
        return true;
      },
    );
  });
});
