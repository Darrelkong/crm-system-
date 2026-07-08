import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { getAiInsightFeedbackStatsForAdmin } from "@/lib/ai/customer-insights/feedback-stats-api";
import { AuthError } from "@/lib/permissions/auth";

const TEST_INSIGHT_ID = "ai999999-9999-9999-9999-999999999903";
const TEST_CUSTOMER_ID = SEED_IDS.customerStaffA;
const TEST_FEEDBACK_IDS = [
  "fb999999-9999-9999-9999-999999999901",
  "fb999999-9999-9999-9999-999999999902",
  "fb999999-9999-9999-9999-999999999903",
  "fb999999-9999-9999-9999-999999999904",
  "fb999999-9999-9999-9999-999999999905",
  "fb999999-9999-9999-9999-999999999906",
  "fb999999-9999-9999-9999-999999999907",
  "fb999999-9999-9999-9999-999999999908",
  "fb999999-9999-9999-9999-999999999909",
  "fb999999-9999-9999-9999-999999999910",
  "fb999999-9999-9999-9999-999999999911",
] as const;

let db: ReturnType<typeof drizzle<typeof schema>>;
let adminUser: User;
let staffUser: User;
let disposeProxy: (() => Promise<void>) | undefined;

async function deleteTestData() {
  await db
    .delete(schema.aiInsightFeedback)
    .where(inArray(schema.aiInsightFeedback.id, [...TEST_FEEDBACK_IDS]));
  await db
    .delete(schema.customerAiInsights)
    .where(eq(schema.customerAiInsights.customerId, TEST_CUSTOMER_ID));
}

async function ensureTestInsight() {
  await db
    .delete(schema.customerAiInsights)
    .where(eq(schema.customerAiInsights.customerId, TEST_CUSTOMER_ID));

  await db.insert(schema.customerAiInsights).values({
    id: TEST_INSIGHT_ID,
    customerId: TEST_CUSTOMER_ID,
    intentLevel: "medium",
    intentScore: 55,
    customerSummary: "Stats test summary",
    currentSituation: "Stats test situation",
    keySignalsJson: "[]",
    riskFlagsJson: "[]",
    missingInformationJson: "[]",
    nextBestAction: "Follow up",
    suggestedFollowUpAt: null,
    suggestedEmployeeMessage: "Hello",
    confidence: 0.7,
    reasoning: "Stats test reasoning",
    model: "gemini-2.5-flash",
    promptVersion: "phase-1d-v1",
    sourceHash: "stats-test-source-hash",
    status: "ready",
    generatedAt: "2026-07-08T10:00:00.000Z",
    createdAt: "2026-07-08T09:00:00.000Z",
    updatedAt: "2026-07-08T10:00:00.000Z",
  });
}

async function insertFeedback(
  id: string,
  rating: number,
  options: {
    model?: string;
    promptVersion?: string;
    reasonTagsJson?: string;
    comment?: string | null;
    insightGeneratedAt?: string;
    updatedAt: string;
  },
) {
  const insightGeneratedAt =
    options.insightGeneratedAt ?? `2026-07-08T10:${id.slice(-2)}:00.000Z`;

  await db.insert(schema.aiInsightFeedback).values({
    id,
    customerId: TEST_CUSTOMER_ID,
    aiInsightId: TEST_INSIGHT_ID,
    insightGeneratedAt,
    model: options.model ?? "gemini-2.5-flash",
    promptVersion: options.promptVersion ?? "phase-1d-v1",
    sourceHash: "stats-test-source-hash",
    rating,
    reasonTagsJson: options.reasonTagsJson ?? "[]",
    comment: options.comment ?? null,
    createdBy: SEED_IDS.admin,
    createdAt: options.updatedAt,
    updatedAt: options.updatedAt,
    updatedBy: SEED_IDS.admin,
  });
}

describe("AI insight feedback stats admin API", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    disposeProxy = proxy.dispose;

    const [admin] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.admin))
      .limit(1);
    const [staff] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.staffA))
      .limit(1);
    assert.ok(admin);
    assert.ok(staff);
    adminUser = admin;
    staffUser = staff;
  });

  after(async () => {
    await deleteTestData();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("admin can get stats", async () => {
    await deleteTestData();
    await ensureTestInsight();
    await insertFeedback(TEST_FEEDBACK_IDS[0], 5, {
      reasonTagsJson: '["too_long"]',
      comment: "helpful",
      updatedAt: "2026-07-08T11:00:00.000Z",
    });

    const result = await getAiInsightFeedbackStatsForAdmin(db, adminUser);
    assert.equal(result.ok, true);
    assert.equal(result.summary.totalCount, 1);
    assert.equal(result.summary.averageRating, 5);
    assert.equal(result.recent.length, 1);
    assert.equal(result.recent[0]?.commentLength, 7);
    assert.equal("comment" in (result.recent[0] ?? {}), false);

    await deleteTestData();
  });

  it("staff get stats returns 403", async () => {
    await assert.rejects(
      () => getAiInsightFeedbackStatsForAdmin(db, staffUser),
      (error: unknown) => error instanceof AuthError && error.status === 403,
    );
  });

  it("returns empty stats when no feedback exists", async () => {
    await deleteTestData();

    const result = await getAiInsightFeedbackStatsForAdmin(db, adminUser);
    assert.equal(result.summary.totalCount, 0);
    assert.equal(result.summary.averageRating, null);
    assert.equal(result.recent.length, 0);
  });

  it("computes rating buckets and group averages", async () => {
    await deleteTestData();
    await ensureTestInsight();

    await insertFeedback(TEST_FEEDBACK_IDS[0], 5, {
      model: "gemini-2.5-flash",
      promptVersion: "phase-1d-v1",
      reasonTagsJson: '["too_long"]',
      updatedAt: "2026-07-08T11:00:00.000Z",
    });
    await insertFeedback(TEST_FEEDBACK_IDS[1], 4, {
      model: "gemini-2.5-flash",
      promptVersion: "phase-1d-v1",
      updatedAt: "2026-07-08T11:01:00.000Z",
    });
    await insertFeedback(TEST_FEEDBACK_IDS[2], 3, {
      model: "gemini-2.5-flash",
      promptVersion: "phase-1b-v1",
      updatedAt: "2026-07-08T11:02:00.000Z",
    });
    await insertFeedback(TEST_FEEDBACK_IDS[3], 2, {
      model: "gemini-2.5-pro",
      promptVersion: "phase-1b-v1",
      reasonTagsJson: '["inaccurate_intent"]',
      updatedAt: "2026-07-08T11:03:00.000Z",
    });
    await insertFeedback(TEST_FEEDBACK_IDS[4], 1, {
      model: "gemini-2.5-pro",
      promptVersion: "phase-1b-v1",
      updatedAt: "2026-07-08T11:04:00.000Z",
    });

    const result = await getAiInsightFeedbackStatsForAdmin(db, adminUser);
    assert.equal(result.summary.totalCount, 5);
    assert.equal(result.summary.helpfulCount, 2);
    assert.equal(result.summary.neutralCount, 1);
    assert.equal(result.summary.notHelpfulCount, 2);
    assert.equal(result.summary.averageRating, 3);

    const flashModel = result.byModel.find((row) => row.model === "gemini-2.5-flash");
    assert.ok(flashModel);
    assert.equal(flashModel.count, 3);
    assert.equal(flashModel.averageRating, 4);

    const promptV1 = result.byPromptVersion.find((row) => row.promptVersion === "phase-1d-v1");
    assert.ok(promptV1);
    assert.equal(promptV1.count, 2);
    assert.equal(promptV1.averageRating, 4.5);

    assert.equal(result.reasonTagRankings.find((row) => row.tag === "too_long")?.count, 1);
    assert.equal(
      result.reasonTagRankings.find((row) => row.tag === "inaccurate_intent")?.count,
      1,
    );

    await deleteTestData();
  });

  it("returns only the 10 most recent feedback rows", async () => {
    await deleteTestData();
    await ensureTestInsight();

    for (let index = 0; index < 11; index += 1) {
      const minute = String(index).padStart(2, "0");
      await insertFeedback(TEST_FEEDBACK_IDS[index]!, 3, {
        insightGeneratedAt: `2026-07-08T12:${minute}:00.000Z`,
        updatedAt: `2026-07-08T12:${minute}:00.000Z`,
      });
    }

    const result = await getAiInsightFeedbackStatsForAdmin(db, adminUser);
    assert.equal(result.summary.totalCount, 11);
    assert.equal(result.recent.length, 10);
    assert.equal(result.recent[0]?.id, TEST_FEEDBACK_IDS[10]);
    assert.equal(result.recent[9]?.id, TEST_FEEDBACK_IDS[1]);

    await deleteTestData();
  });
});
