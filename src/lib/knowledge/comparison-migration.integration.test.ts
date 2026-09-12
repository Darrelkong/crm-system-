import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import { bindTestDatabase } from "@/lib/db";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

describe("Knowledge comparison migration — disposable D1", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
  });

  after(async () => {
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("applies 0082 locally with integrity checks", async () => {
    const migration = await db.all<{ name: string }>(
      sql`SELECT name FROM d1_migrations WHERE name = '0082_knowledge_ai_comparison_runs.sql'`,
    );
    assert.equal(migration.length, 1);

    const table = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_ai_comparison_runs'`,
    );
    assert.equal(table.length, 1);

    const quickCheck = await db.all<{ quick_check: string }>(
      sql`PRAGMA quick_check`,
    );
    assert.equal(quickCheck[0]?.quick_check, "ok");

    const foreignKeys = await db.all(sql`PRAGMA foreign_key_check`);
    assert.equal(foreignKeys.length, 0);
  });

  it("enforces one active comparison run per source", async () => {
    const now = new Date().toISOString();
    const sourceId = crypto.randomUUID();
    const orgRunId = crypto.randomUUID();
    const userId = (
      await db.select({ id: schema.users.id }).from(schema.users).limit(1)
    )[0]?.id;
    assert.ok(userId);

    await db.insert(schema.knowledgeSources).values({
      id: sourceId,
      sourceType: "paste",
      sourceTitle: "migration test",
      originalFilename: null,
      mimeType: "text/plain",
      sizeBytes: 10,
      rawText: "test",
      storageKey: null,
      contentHash: `hash-${sourceId}`,
      status: "organized",
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
      processedAt: now,
      failureCode: null,
      linkedArticleId: null,
      archivedAt: null,
      archivedByUserId: null,
    });
    await db.insert(schema.knowledgeAiOrganizationRuns).values({
      id: orgRunId,
      sourceId,
      requestedByUserId: userId,
      status: "completed",
      provider: "mock",
      model: "mock",
      proposedTitle: "title",
      proposedSummary: null,
      proposedBody: "body",
      proposedCategory: null,
      warningsJson: "[]",
      createdAt: now,
      completedAt: now,
      failureCode: null,
    });

    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    await db.insert(schema.knowledgeAiComparisonRuns).values({
      id: firstId,
      sourceId,
      organizationRunId: orgRunId,
      requestedByUserId: userId,
      status: "processing",
      candidateSnapshotJson: "[]",
      createdAt: now,
    });

    await assert.rejects(
      () =>
        db.insert(schema.knowledgeAiComparisonRuns).values({
          id: secondId,
          sourceId,
          organizationRunId: orgRunId,
          requestedByUserId: userId,
          status: "pending",
          candidateSnapshotJson: "[]",
          createdAt: now,
        }),
    );

    await db
      .update(schema.knowledgeAiComparisonRuns)
      .set({ status: "completed", relationship: "no_match", completedAt: now })
      .where(eq(schema.knowledgeAiComparisonRuns.id, firstId));

    await db.insert(schema.knowledgeAiComparisonRuns).values({
      id: secondId,
      sourceId,
      organizationRunId: orgRunId,
      requestedByUserId: userId,
      status: "completed",
      relationship: "no_match",
      candidateSnapshotJson: "[]",
      comparisonJson: JSON.stringify({
        relationship: "no_match",
        matchedCandidateKey: null,
        matchConfidence: null,
        newFacts: [],
        changedFacts: [],
        conflicts: [],
        uncertainties: [],
        suggestedUpdates: [],
      }),
      createdAt: now,
      completedAt: now,
    });

    const runs = await db
      .select()
      .from(schema.knowledgeAiComparisonRuns)
      .where(eq(schema.knowledgeAiComparisonRuns.sourceId, sourceId));
    assert.equal(runs.length, 2);

    await db.delete(schema.knowledgeAiComparisonRuns);
    await db.delete(schema.knowledgeAiOrganizationRuns);
    await db.delete(schema.knowledgeSources).where(eq(schema.knowledgeSources.id, sourceId));
  });
});
