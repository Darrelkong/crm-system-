import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import {
  AiInsightFeedbackApiError,
  getCustomerAiInsightFeedbackForAdmin,
  upsertCustomerAiInsightFeedbackForAdmin,
} from "@/lib/ai/customer-insights/feedback-api";
import { AuthError } from "@/lib/permissions/auth";
import {
  getCustomerAiInsightByCustomerId,
  refreshCustomerAiInsight,
} from "@/lib/ai/customer-insights/service";

const TEST_INSIGHT_ID = "ai999999-9999-9999-9999-999999999902";
const TEST_CUSTOMER_ID = SEED_IDS.customerStaffA;
const GENERATED_AT = "2026-07-08T10:00:00.000Z";

let db: ReturnType<typeof drizzle<typeof schema>>;
let adminUser: User;
let staffUser: User;
let disposeProxy: (() => Promise<void>) | undefined;

async function deleteTestFeedback() {
  await db
    .delete(schema.aiInsightFeedback)
    .where(eq(schema.aiInsightFeedback.customerId, TEST_CUSTOMER_ID));
}

async function deleteTestInsight() {
  await db
    .delete(schema.customerAiInsights)
    .where(eq(schema.customerAiInsights.customerId, TEST_CUSTOMER_ID));
}

async function insertReadyInsight(
  generatedAt = GENERATED_AT,
  status: "ready" | "failed" = "ready",
) {
  const ts = "2026-07-08T09:00:00.000Z";
  await db.insert(schema.customerAiInsights).values({
    id: TEST_INSIGHT_ID,
    customerId: TEST_CUSTOMER_ID,
    intentLevel: "medium",
    intentScore: 55,
    customerSummary: "Feedback test summary",
    currentSituation: "Feedback test situation",
    keySignalsJson: "[]",
    riskFlagsJson: "[]",
    missingInformationJson: "[]",
    nextBestAction: "Follow up soon",
    suggestedFollowUpAt: null,
    suggestedEmployeeMessage: "Hello",
    confidence: 0.7,
    reasoning: "Feedback test reasoning",
    model: "gemini-2.5-flash",
    promptVersion: "phase-1b-v1",
    sourceHash: "feedback-test-source-hash",
    status,
    generatedAt,
    createdAt: ts,
    updatedAt: generatedAt,
  });
}

describe("AI insight feedback admin API", () => {
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
    await deleteTestFeedback();
    await deleteTestInsight();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("admin can GET feedback when none exists", async () => {
    await deleteTestFeedback();
    await deleteTestInsight();
    await insertReadyInsight();

    const result = await getCustomerAiInsightFeedbackForAdmin(
      db,
      adminUser,
      TEST_CUSTOMER_ID,
    );
    assert.equal(result.feedback, null);
  });

  it("admin can POST create feedback", async () => {
    await deleteTestFeedback();
    await deleteTestInsight();
    await insertReadyInsight();

    const result = await upsertCustomerAiInsightFeedbackForAdmin(
      db,
      adminUser,
      TEST_CUSTOMER_ID,
      {
        insightGeneratedAt: GENERATED_AT,
        rating: 4,
        reasonTags: ["too_long"],
        comment: "Good overall",
      },
    );

    assert.equal(result.created, true);
    assert.equal(result.feedback.rating, 4);
    assert.deepEqual(result.feedback.reasonTags, ["too_long"]);
    assert.equal(result.feedback.comment, "Good overall");
    assert.equal(result.feedback.model, "gemini-2.5-flash");
    assert.equal(result.feedback.promptVersion, "phase-1b-v1");
  });

  it("admin POST again updates feedback without duplicate rows", async () => {
    await deleteTestFeedback();
    await deleteTestInsight();
    await insertReadyInsight();

    const created = await upsertCustomerAiInsightFeedbackForAdmin(
      db,
      adminUser,
      TEST_CUSTOMER_ID,
      {
        insightGeneratedAt: GENERATED_AT,
        rating: 2,
        reasonTags: ["inaccurate_intent"],
        comment: null,
      },
    );
    assert.equal(created.created, true);
    const firstId = created.feedback.id;

    const updated = await upsertCustomerAiInsightFeedbackForAdmin(
      db,
      adminUser,
      TEST_CUSTOMER_ID,
      {
        insightGeneratedAt: GENERATED_AT,
        rating: 3,
        reasonTags: ["next_action_too_generic", "other"],
        comment: "Updated note",
      },
    );
    assert.equal(updated.created, false);
    assert.equal(updated.feedback.id, firstId);
    assert.equal(updated.feedback.rating, 3);
    assert.deepEqual(updated.feedback.reasonTags, ["next_action_too_generic", "other"]);

    const rows = await db
      .select()
      .from(schema.aiInsightFeedback)
      .where(eq(schema.aiInsightFeedback.customerId, TEST_CUSTOMER_ID));
    assert.equal(rows.length, 1);
  });

  it("staff GET returns 403", async () => {
    await assert.rejects(
      () => getCustomerAiInsightFeedbackForAdmin(db, staffUser, TEST_CUSTOMER_ID),
      (error: unknown) => error instanceof AuthError && error.status === 403,
    );
  });

  it("staff POST returns 403", async () => {
    await assert.rejects(
      () =>
        upsertCustomerAiInsightFeedbackForAdmin(db, staffUser, TEST_CUSTOMER_ID, {
          insightGeneratedAt: GENERATED_AT,
          rating: 5,
          reasonTags: [],
        }),
      (error: unknown) => error instanceof AuthError && error.status === 403,
    );
  });

  it("rating outside 1-5 returns 400", async () => {
    await deleteTestFeedback();
    await deleteTestInsight();
    await insertReadyInsight();

    await assert.rejects(
      () =>
        upsertCustomerAiInsightFeedbackForAdmin(db, adminUser, TEST_CUSTOMER_ID, {
          insightGeneratedAt: GENERATED_AT,
          rating: 6,
          reasonTags: [],
        }),
      (error: unknown) =>
        error instanceof AiInsightFeedbackApiError &&
        error.status === 400 &&
        error.errorCode === "INVALID_RATING",
    );
  });

  it("invalid reasonTags returns 400", async () => {
    await deleteTestFeedback();
    await deleteTestInsight();
    await insertReadyInsight();

    await assert.rejects(
      () =>
        upsertCustomerAiInsightFeedbackForAdmin(db, adminUser, TEST_CUSTOMER_ID, {
          insightGeneratedAt: GENERATED_AT,
          rating: 2,
          reasonTags: ["not_a_real_tag"],
        }),
      (error: unknown) =>
        error instanceof AiInsightFeedbackApiError &&
        error.status === 400 &&
        error.errorCode === "INVALID_REASON_TAGS",
    );
  });

  it("insightGeneratedAt mismatch returns 409", async () => {
    await deleteTestFeedback();
    await deleteTestInsight();
    await insertReadyInsight();

    await assert.rejects(
      () =>
        upsertCustomerAiInsightFeedbackForAdmin(db, adminUser, TEST_CUSTOMER_ID, {
          insightGeneratedAt: "2026-01-01T00:00:00.000Z",
          rating: 4,
          reasonTags: [],
        }),
      (error: unknown) =>
        error instanceof AiInsightFeedbackApiError &&
        error.status === 409 &&
        error.errorCode === "INSIGHT_VERSION_MISMATCH",
    );
  });

  it("cannot rate when insight is not ready", async () => {
    await deleteTestFeedback();
    await deleteTestInsight();
    await insertReadyInsight(GENERATED_AT, "failed");

    await assert.rejects(
      () =>
        upsertCustomerAiInsightFeedbackForAdmin(db, adminUser, TEST_CUSTOMER_ID, {
          insightGeneratedAt: GENERATED_AT,
          rating: 4,
          reasonTags: [],
        }),
      (error: unknown) =>
        error instanceof AiInsightFeedbackApiError &&
        error.status === 422 &&
        error.errorCode === "INSIGHT_NOT_READY",
    );
  });

  it("GET returns null when insight is not ready", async () => {
    await deleteTestFeedback();
    await deleteTestInsight();
    await insertReadyInsight(GENERATED_AT, "failed");

    const result = await getCustomerAiInsightFeedbackForAdmin(
      db,
      adminUser,
      TEST_CUSTOMER_ID,
    );
    assert.equal(result.feedback, null);
  });

  it("AI refresh flow remains unaffected", async () => {
    await deleteTestFeedback();
    await deleteTestInsight();

    const [customer] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, TEST_CUSTOMER_ID))
      .limit(1);
    assert.ok(customer);

    const refreshResult = await refreshCustomerAiInsight(db, adminUser, customer);
    assert.equal(refreshResult.providerKind, "mock");
    assert.equal(refreshResult.insight.status, "ready");

    const insight = await getCustomerAiInsightByCustomerId(db, TEST_CUSTOMER_ID);
    assert.ok(insight);
    assert.equal(insight.status, "ready");

    await deleteTestInsight();
  });
});
