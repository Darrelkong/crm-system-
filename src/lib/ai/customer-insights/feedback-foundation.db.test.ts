import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { buildAiInsightGenerationKey } from "@/lib/ai/customer-insights/feedback-generation-key";
import { ensureAiInsightFeedbackPhase5dMigrationForTests } from "@/lib/ai/customer-insights/test-helpers/ensure-feedback-phase5d-migration";
import {
  getActorFeedbackForGeneration,
  listFeedbackForGeneration,
  upsertActorComponentFeedback,
} from "@/lib/ai/customer-insights/feedback-repository";

const TEST_INSIGHT_ID = "ai999999-9999-9999-9999-9999999995d1";
const TEST_CUSTOMER_ID = SEED_IDS.customerStaffA;
const GENERATED_AT = "2026-07-25T04:00:00.000Z";
const SOURCE_HASH = "phase5d1-source-hash";
const GENERATION_KEY = buildAiInsightGenerationKey({
  aiInsightId: TEST_INSIGHT_ID,
  insightGeneratedAt: GENERATED_AT,
  sourceHash: SOURCE_HASH,
});

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

async function deleteTestRows() {
  await db
    .delete(schema.aiInsightFeedback)
    .where(eq(schema.aiInsightFeedback.customerId, TEST_CUSTOMER_ID));
  await db
    .delete(schema.customerAiInsights)
    .where(eq(schema.customerAiInsights.customerId, TEST_CUSTOMER_ID));
}

async function insertReadyInsight() {
  const ts = "2026-07-25T03:00:00.000Z";
  await db.insert(schema.customerAiInsights).values({
    id: TEST_INSIGHT_ID,
    customerId: TEST_CUSTOMER_ID,
    intentLevel: "medium",
    intentScore: 55,
    customerSummary: "5D-1 foundation summary",
    currentSituation: "5D-1 foundation situation",
    keySignalsJson: "[]",
    riskFlagsJson: "[]",
    missingInformationJson: "[]",
    nextBestAction: "Follow up",
    suggestedFollowUpAt: null,
    suggestedEmployeeMessage: "Hello",
    confidence: 0.7,
    reasoning: "5D-1 foundation reasoning",
    model: "gemini-2.5-flash",
    promptVersion: "phase-1d-v1",
    sourceHash: SOURCE_HASH,
    status: "ready",
    generatedAt: GENERATED_AT,
    createdAt: ts,
    updatedAt: GENERATED_AT,
    phase2Json: null,
  });
}

describe("Phase 5D-1 feedback foundation (local D1)", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{
      DB: {
        prepare: (query: string) => {
          first: <T>() => Promise<T | null>;
          run: () => Promise<unknown>;
        };
      };
    }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    await ensureAiInsightFeedbackPhase5dMigrationForTests(proxy.env.DB);
    await deleteTestRows();
    await insertReadyInsight();
  });

  after(async () => {
    await deleteTestRows();
    if (disposeProxy) await disposeProxy();
  });

  it("preserves legacy row shape after migration columns exist", async () => {
    const id = "fb-legacy-5d1-0001";
    await db.insert(schema.aiInsightFeedback).values({
      id,
      customerId: TEST_CUSTOMER_ID,
      aiInsightId: TEST_INSIGHT_ID,
      insightGeneratedAt: GENERATED_AT,
      model: "gemini-2.5-flash",
      promptVersion: "phase-1d-v1",
      sourceHash: SOURCE_HASH,
      rating: 5,
      reasonTagsJson: '["too_long"]',
      comment: "legacy comment",
      createdBy: SEED_IDS.admin,
      createdAt: "2026-07-08T17:42:57.498Z",
      updatedAt: "2026-07-08T17:42:57.498Z",
      updatedBy: null,
      generationKey: GENERATION_KEY,
      feedbackTarget: "legacy_overall",
      ratingCode: null,
      providerSnapshot: null,
      contractModeSnapshot: null,
      phase2GeneratedSnapshot: null,
      actorRoleSnapshot: null,
      degradationReasonSnapshot: null,
    });

    const [row] = await db
      .select()
      .from(schema.aiInsightFeedback)
      .where(eq(schema.aiInsightFeedback.id, id))
      .limit(1);

    assert.equal(row?.rating, 5);
    assert.equal(row?.feedbackTarget, "legacy_overall");
    assert.equal(row?.ratingCode, null);
    assert.equal(row?.comment, "legacy comment");
    assert.equal(row?.generationKey, GENERATION_KEY);

    await db
      .delete(schema.aiInsightFeedback)
      .where(eq(schema.aiInsightFeedback.id, id));
  });

  it("allows multi-target and multi-actor component feedback", async () => {
    const baseSnap = {
      providerSnapshot: "google_gemini" as const,
      modelSnapshot: "gemini-2.5-flash",
      promptVersionSnapshot: "phase-1d-v1",
      contractModeSnapshot: "gemini_flat" as const,
      phase2GeneratedSnapshot: true,
      actorRoleSnapshot: "admin" as const,
      degradationReasonSnapshot: null,
    };

    const adminBase = await upsertActorComponentFeedback(db, {
      customerId: TEST_CUSTOMER_ID,
      aiInsightId: TEST_INSIGHT_ID,
      insightGeneratedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
      model: "gemini-2.5-flash",
      promptVersion: "phase-1d-v1",
      feedbackTarget: "base_deep",
      ratingCode: "helpful",
      tags: ["accurate_summary"],
      snapshots: { ...baseSnap, actorRoleSnapshot: "admin" },
      actorUserId: SEED_IDS.admin,
    });
    assert.equal(adminBase.created, true);
    assert.equal(adminBase.feedback.comment, null);
    assert.equal(adminBase.feedback.ratingCode, "helpful");

    const adminPhase2 = await upsertActorComponentFeedback(db, {
      customerId: TEST_CUSTOMER_ID,
      aiInsightId: TEST_INSIGHT_ID,
      insightGeneratedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
      model: "gemini-2.5-flash",
      promptVersion: "phase-1d-v1",
      feedbackTarget: "phase2",
      ratingCode: "not_helpful",
      tags: ["insufficient_data"],
      snapshots: baseSnap,
      actorUserId: SEED_IDS.admin,
    });
    assert.equal(adminPhase2.created, true);

    const staffBase = await upsertActorComponentFeedback(db, {
      customerId: TEST_CUSTOMER_ID,
      aiInsightId: TEST_INSIGHT_ID,
      insightGeneratedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
      model: "gemini-2.5-flash",
      promptVersion: "phase-1d-v1",
      feedbackTarget: "base_deep",
      ratingCode: "not_helpful",
      tags: ["too_generic"],
      snapshots: { ...baseSnap, actorRoleSnapshot: "staff" },
      actorUserId: SEED_IDS.staffA,
    });
    assert.equal(staffBase.created, true);

    const listed = await listFeedbackForGeneration(db, GENERATION_KEY);
    assert.equal(listed.length, 3);
  });

  it("updates same actor/generation/target and preserves createdAt", async () => {
    const first = await getActorFeedbackForGeneration(db, {
      generationKey: GENERATION_KEY,
      actorUserId: SEED_IDS.admin,
      feedbackTarget: "base_deep",
    });
    assert.ok(first);
    const createdAt = first.createdAt;

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await upsertActorComponentFeedback(db, {
      customerId: TEST_CUSTOMER_ID,
      aiInsightId: TEST_INSIGHT_ID,
      insightGeneratedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
      model: "gemini-2.5-flash",
      promptVersion: "phase-1d-v1",
      feedbackTarget: "base_deep",
      ratingCode: "not_helpful",
      tags: ["inaccurate"],
      snapshots: {
        providerSnapshot: "google_gemini",
        modelSnapshot: "gemini-2.5-flash",
        promptVersionSnapshot: "phase-1d-v1",
        contractModeSnapshot: "gemini_flat",
        phase2GeneratedSnapshot: true,
        actorRoleSnapshot: "admin",
      },
      actorUserId: SEED_IDS.admin,
    });

    assert.equal(second.created, false);
    assert.equal(second.feedback.createdAt, createdAt);
    assert.notEqual(second.feedback.updatedAt, createdAt);
    assert.equal(second.feedback.ratingCode, "not_helpful");
    assert.deepEqual(second.feedback.reasonTags, ["inaccurate"]);
  });

  it("rejects duplicate same actor/generation/target at DB unique layer", async () => {
    await assert.rejects(async () => {
      await db.insert(schema.aiInsightFeedback).values({
        id: crypto.randomUUID(),
        customerId: TEST_CUSTOMER_ID,
        aiInsightId: TEST_INSIGHT_ID,
        insightGeneratedAt: GENERATED_AT,
        model: "gemini-2.5-flash",
        promptVersion: "phase-1d-v1",
        sourceHash: SOURCE_HASH,
        rating: null,
        reasonTagsJson: "[]",
        comment: null,
        createdBy: SEED_IDS.admin,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: null,
        generationKey: GENERATION_KEY,
        feedbackTarget: "base_deep",
        ratingCode: "helpful",
        providerSnapshot: "google_gemini",
        contractModeSnapshot: "gemini_flat",
        phase2GeneratedSnapshot: true,
        actorRoleSnapshot: "admin",
        degradationReasonSnapshot: null,
      });
    });
  });

  it("allows a new generation for the same actor/target", async () => {
    const newGeneratedAt = "2026-07-25T05:00:00.000Z";
    const newHash = "phase5d1-source-hash-v2";
    await db
      .update(schema.customerAiInsights)
      .set({
        generatedAt: newGeneratedAt,
        sourceHash: newHash,
        updatedAt: newGeneratedAt,
      })
      .where(eq(schema.customerAiInsights.id, TEST_INSIGHT_ID));

    const result = await upsertActorComponentFeedback(db, {
      customerId: TEST_CUSTOMER_ID,
      aiInsightId: TEST_INSIGHT_ID,
      insightGeneratedAt: newGeneratedAt,
      sourceHash: newHash,
      model: "gemini-2.5-flash",
      promptVersion: "phase-1d-v1",
      feedbackTarget: "base_deep",
      ratingCode: "helpful",
      tags: [],
      snapshots: {
        providerSnapshot: "google_gemini",
        modelSnapshot: "gemini-2.5-flash",
        promptVersionSnapshot: "phase-1d-v1",
        contractModeSnapshot: "gemini_flat",
        phase2GeneratedSnapshot: false,
        actorRoleSnapshot: "admin",
        degradationReasonSnapshot: "missing_signals",
      },
      actorUserId: SEED_IDS.admin,
    });

    assert.equal(result.created, true);
    assert.notEqual(result.feedback.generationKey, GENERATION_KEY);

    const oldStillThere = await getActorFeedbackForGeneration(db, {
      generationKey: GENERATION_KEY,
      actorUserId: SEED_IDS.admin,
      feedbackTarget: "base_deep",
    });
    assert.ok(oldStillThere);
  });

  it("enforces legacy unique on customer_id + generated_at", async () => {
    const legacyGeneratedAt = "2026-07-01T00:00:00.000Z";
    await db.insert(schema.aiInsightFeedback).values({
      id: "fb-legacy-unique-1",
      customerId: TEST_CUSTOMER_ID,
      aiInsightId: TEST_INSIGHT_ID,
      insightGeneratedAt: legacyGeneratedAt,
      model: "gemini-2.5-flash",
      promptVersion: "phase-1d-v1",
      sourceHash: "legacy-unique-hash",
      rating: 1,
      reasonTagsJson: "[]",
      comment: null,
      createdBy: SEED_IDS.admin,
      createdAt: legacyGeneratedAt,
      updatedAt: legacyGeneratedAt,
      updatedBy: null,
      generationKey: `${TEST_INSIGHT_ID}|${legacyGeneratedAt}|legacy-unique-hash`,
      feedbackTarget: "legacy_overall",
      ratingCode: null,
    });

    await assert.rejects(async () => {
      await db.insert(schema.aiInsightFeedback).values({
        id: "fb-legacy-unique-2",
        customerId: TEST_CUSTOMER_ID,
        aiInsightId: TEST_INSIGHT_ID,
        insightGeneratedAt: legacyGeneratedAt,
        model: "gemini-2.5-flash",
        promptVersion: "phase-1d-v1",
        sourceHash: "legacy-unique-hash",
        rating: 5,
        reasonTagsJson: "[]",
        comment: null,
        createdBy: SEED_IDS.staffA,
        createdAt: legacyGeneratedAt,
        updatedAt: legacyGeneratedAt,
        updatedBy: null,
        generationKey: `${TEST_INSIGHT_ID}|${legacyGeneratedAt}|legacy-unique-hash`,
        feedbackTarget: "legacy_overall",
        ratingCode: null,
      });
    });

    await db
      .delete(schema.aiInsightFeedback)
      .where(
        and(
          eq(schema.aiInsightFeedback.customerId, TEST_CUSTOMER_ID),
          eq(schema.aiInsightFeedback.insightGeneratedAt, legacyGeneratedAt),
        ),
      );
  });
});
