import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  formatCustomerAiInsight,
  getCustomerAiInsightByCustomerId,
  persistReadyInsight,
} from "@/lib/ai/customer-insights/service";
import { serializePhase2Insight } from "@/lib/ai/customer-insights/phase2-compose";
import type { Phase2Insight } from "@/lib/ai/phase2/types";
import { PHASE2_VERSION } from "@/lib/ai/phase2/types";
import type { CustomerInsightOutput } from "@/lib/ai/customer-insights/schema";
const TEST_INSIGHT_ID = "ai999999-9999-9999-9999-999999999936";
const TEST_CUSTOMER_ID = SEED_IDS.customerStaffA;

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;

async function deleteTestInsight() {
  await db
    .delete(schema.customerAiInsights)
    .where(eq(schema.customerAiInsights.customerId, TEST_CUSTOMER_ID));
}

function minimalPhase2(): Phase2Insight {
  return {
    version: PHASE2_VERSION,
    opportunity: {
      status: "insufficient_data",
      score: null,
      confidence: "low",
      trend: "unavailable",
      breakdown: [],
      positiveFactors: [],
      negativeFactors: [],
      recommendedAction: null,
    },
    painPoints: [],
    churnRisk: {
      level: "insufficient_data",
      confidence: "low",
      customerBehaviorRisk: [],
      crmProcessRisk: [],
      evidence: [],
      summary: "Insufficient follow-up data to assess churn-related risk",
    },
    followUpRecommendation: {
      date: null,
      timeWindow: null,
      channel: null,
      topic: null,
      confidence: "low",
      basis: [],
      insufficientDataReason:
        "No explicit next_follow_up_at or appointment evidence; reply-time windows are not inferred",
    },
    missingInformation: [],
  };
}

describe("phase2 insight storage (local D1)", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;
    await deleteTestInsight();
  });

  after(async () => {
    await deleteTestInsight();
    if (disposeProxy) await disposeProxy();
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
  });

  it("keeps phase2_json null for legacy rows and parses valid JSON", async () => {
    const now = "2026-07-20T10:00:00.000Z";
    await db.insert(schema.customerAiInsights).values({
      id: TEST_INSIGHT_ID,
      customerId: TEST_CUSTOMER_ID,
      intentLevel: "medium",
      intentScore: 40,
      customerSummary: "legacy",
      currentSituation: "legacy",
      keySignalsJson: "[]",
      riskFlagsJson: "[]",
      missingInformationJson: "[]",
      nextBestAction: "follow",
      suggestedFollowUpAt: null,
      suggestedEmployeeMessage: "你好",
      confidence: 0.4,
      reasoning: "legacy",
      model: "test",
      promptVersion: "phase-1d-v1",
      sourceHash: "hash-legacy",
      phase2Json: null,
      status: "ready",
      generatedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const legacy = await getCustomerAiInsightByCustomerId(db, TEST_CUSTOMER_ID);
    assert.ok(legacy);
    assert.equal(legacy.phase2, null);
    assert.equal(legacy.intentScore, 40);

    const phase2 = minimalPhase2();
    await db
      .update(schema.customerAiInsights)
      .set({ phase2Json: serializePhase2Insight(phase2), updatedAt: now })
      .where(eq(schema.customerAiInsights.customerId, TEST_CUSTOMER_ID));

    const withPhase2 = await getCustomerAiInsightByCustomerId(db, TEST_CUSTOMER_ID);
    assert.ok(withPhase2?.phase2);
    assert.equal(withPhase2.phase2.version, PHASE2_VERSION);
    assert.equal(withPhase2.phase2.opportunity.score, null);

    await db
      .update(schema.customerAiInsights)
      .set({ phase2Json: "{not-valid", updatedAt: now })
      .where(eq(schema.customerAiInsights.customerId, TEST_CUSTOMER_ID));
    const malformed = await getCustomerAiInsightByCustomerId(db, TEST_CUSTOMER_ID);
    assert.equal(malformed?.phase2, null);
    assert.equal(malformed?.intentScore, 40);

    await db
      .update(schema.customerAiInsights)
      .set({ phase2Json: null, updatedAt: now })
      .where(eq(schema.customerAiInsights.customerId, TEST_CUSTOMER_ID));
    const cleared = await getCustomerAiInsightByCustomerId(db, TEST_CUSTOMER_ID);
    assert.equal(cleared?.phase2, null);

    const [row] = await db
      .select()
      .from(schema.customerAiInsights)
      .where(eq(schema.customerAiInsights.customerId, TEST_CUSTOMER_ID))
      .limit(1);
    assert.ok(row);
    assert.equal(formatCustomerAiInsight(row).phase2, null);
  });

  it("persistReadyInsight with phase2Json=null clears stale Phase 2 on ready refresh", async () => {
    await deleteTestInsight();
    const now = "2026-07-20T11:00:00.000Z";
    const baseOutput: CustomerInsightOutput = {
      intentLevel: "medium",
      intentScore: 55,
      customerSummary: "ready full",
      currentSituation: "ready full",
      keySignals: ["signal"],
      riskFlags: [],
      missingInformation: [],
      nextBestAction: "follow",
      suggestedFollowUpAt: null,
      suggestedEmployeeMessage: "您好，想确认一下资料准备进度。",
      confidence: 0.6,
      reasoning: "fixture",
    };

    await db.insert(schema.customerAiInsights).values({
      id: TEST_INSIGHT_ID,
      customerId: TEST_CUSTOMER_ID,
      intentLevel: baseOutput.intentLevel,
      intentScore: baseOutput.intentScore,
      customerSummary: baseOutput.customerSummary,
      currentSituation: baseOutput.currentSituation,
      keySignalsJson: JSON.stringify(baseOutput.keySignals),
      riskFlagsJson: "[]",
      missingInformationJson: "[]",
      nextBestAction: baseOutput.nextBestAction,
      suggestedFollowUpAt: null,
      suggestedEmployeeMessage: baseOutput.suggestedEmployeeMessage,
      confidence: baseOutput.confidence,
      reasoning: baseOutput.reasoning,
      model: "test-model",
      promptVersion: "phase-1d-v1",
      sourceHash: "hash-full",
      phase2Json: serializePhase2Insight(minimalPhase2()),
      status: "ready",
      generatedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const before = await getCustomerAiInsightByCustomerId(db, TEST_CUSTOMER_ID);
    assert.ok(before?.phase2);

    // Simulate Base-ready + Phase2-degraded refresh: upsert writes null.
    const after = await persistReadyInsight(db, TEST_CUSTOMER_ID, baseOutput, {
      model: "test-model",
      promptVersion: "phase-1d-v1",
      sourceHash: "hash-base-only",
      phase2Json: null,
    });
    assert.equal(after.status, "ready");
    assert.equal(after.phase2, null);
    assert.equal(after.intentScore, 55);

    const [raw] = await db
      .select()
      .from(schema.customerAiInsights)
      .where(eq(schema.customerAiInsights.customerId, TEST_CUSTOMER_ID))
      .limit(1);
    assert.ok(raw);
    assert.equal(raw.phase2Json, null);
    assert.equal(raw.status, "ready");
  });
});
