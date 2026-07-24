import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { AI_REFRESH_COOLDOWN_MS } from "@/lib/ai/customer-insights/cooldown";
import { getSafeAiRefreshErrorMessage } from "@/lib/ai/customer-insights/error-mapping";
import {
  AiRefreshCooldownError,
} from "@/lib/ai/customer-insights/errors";
import {
  getCustomerAiInsightByCustomerId,
  refreshCustomerAiInsight,
} from "@/lib/ai/customer-insights/service";

const TEST_INSIGHT_ID = "ai999999-9999-9999-9999-999999999901";
const TEST_CUSTOMER_ID = SEED_IDS.customerStaffA;
const TRACKER_MODEL = "mock-customer-insight-v1";

let db: ReturnType<typeof drizzle<typeof schema>>;
let adminUser: User;
let customer: Customer;
let disposeProxy: (() => Promise<void>) | undefined;

async function deleteTestInsight() {
  await db
    .delete(schema.customerAiInsights)
    .where(eq(schema.customerAiInsights.customerId, TEST_CUSTOMER_ID));
}

async function insertTestInsight(generatedAt: string, model = TRACKER_MODEL) {
  const ts = "2026-06-30T10:00:00.000Z";
  await db.insert(schema.customerAiInsights).values({
    id: TEST_INSIGHT_ID,
    customerId: TEST_CUSTOMER_ID,
    intentLevel: "medium",
    intentScore: 50,
    customerSummary: "Cooldown test summary",
    currentSituation: "Cooldown test situation",
    keySignalsJson: "[]",
    riskFlagsJson: "[]",
    missingInformationJson: "[]",
    nextBestAction: "Follow up",
    suggestedFollowUpAt: null,
    suggestedEmployeeMessage: "Hello",
    confidence: 0.5,
    reasoning: "Test insight",
    model,
    promptVersion: "phase-1b-v1",
    sourceHash: "cooldown-test-source-hash",
    status: "ready",
    generatedAt,
    createdAt: ts,
    updatedAt: generatedAt,
  });
}

describe("refreshCustomerAiInsight cooldown", () => {
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
    const [seedCustomer] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, TEST_CUSTOMER_ID))
      .limit(1);

    assert.ok(admin);
    assert.ok(seedCustomer);
    adminUser = admin;
    customer = seedCustomer;
  });

  after(async () => {
    await deleteTestInsight();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("allows refresh when no existing insight", async () => {
    await deleteTestInsight();

    const result = await refreshCustomerAiInsight(db, adminUser, customer);
    assert.equal(result.providerKind, "mock");
    assert.ok(result.insight.generatedAt);

    await deleteTestInsight();
  });

  it("rejects refresh within cooldown for ready insight and does not call provider", async () => {
    await deleteTestInsight();
    const recentGeneratedAt = new Date().toISOString();
    await insertTestInsight(recentGeneratedAt, "cooldown-tracker-model");

    await assert.rejects(
      () => refreshCustomerAiInsight(db, adminUser, customer),
      (error: unknown) => {
        assert.equal(error instanceof AiRefreshCooldownError, true);
        assert.equal((error as AiRefreshCooldownError).code, "AI_REFRESH_COOLDOWN");
        return true;
      },
    );

    const unchanged = await getCustomerAiInsightByCustomerId(db, TEST_CUSTOMER_ID);
    assert.ok(unchanged);
    assert.equal(unchanged.generatedAt, recentGeneratedAt);
    assert.equal(unchanged.model, "cooldown-tracker-model");

    await deleteTestInsight();
  });

  it("allows refresh when existing insight is failed with recent generatedAt", async () => {
    await deleteTestInsight();
    const recentGeneratedAt = new Date().toISOString();
    await insertTestInsight(recentGeneratedAt, "failed-tracker-model");
    await db
      .update(schema.customerAiInsights)
      .set({ status: "failed" })
      .where(eq(schema.customerAiInsights.customerId, TEST_CUSTOMER_ID));

    const result = await refreshCustomerAiInsight(db, adminUser, customer);
    assert.equal(result.providerKind, "mock");
    assert.notEqual(result.insight.generatedAt, recentGeneratedAt);
    assert.equal(result.insight.status, "ready");

    await deleteTestInsight();
  });

  it("allows refresh for a second customer while first is on cooldown", async () => {
    await deleteTestInsight();
    const otherCustomerId = SEED_IDS.customerStaffB;
    await db
      .delete(schema.customerAiInsights)
      .where(eq(schema.customerAiInsights.customerId, otherCustomerId));

    const recentGeneratedAt = new Date().toISOString();
    await insertTestInsight(recentGeneratedAt, "cooldown-tracker-model");

    await assert.rejects(
      () => refreshCustomerAiInsight(db, adminUser, customer),
      (error: unknown) => error instanceof AiRefreshCooldownError,
    );

    const [otherCustomer] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, otherCustomerId))
      .limit(1);
    assert.ok(otherCustomer);

    const otherResult = await refreshCustomerAiInsight(
      db,
      adminUser,
      otherCustomer,
    );
    assert.equal(otherResult.providerKind, "mock");
    assert.equal(otherResult.insight.customerId, otherCustomerId);

    const firstUnchanged = await getCustomerAiInsightByCustomerId(
      db,
      TEST_CUSTOMER_ID,
    );
    assert.ok(firstUnchanged);
    assert.equal(firstUnchanged.generatedAt, recentGeneratedAt);
    assert.equal(firstUnchanged.model, "cooldown-tracker-model");

    await db
      .delete(schema.customerAiInsights)
      .where(eq(schema.customerAiInsights.customerId, otherCustomerId));
    await deleteTestInsight();
  });

  it("allows refresh after cooldown window expires", async () => {
    await deleteTestInsight();
    const expiredGeneratedAt = new Date(
      Date.now() - AI_REFRESH_COOLDOWN_MS - 1_000,
    ).toISOString();
    await insertTestInsight(expiredGeneratedAt, "expired-tracker-model");

    const result = await refreshCustomerAiInsight(db, adminUser, customer);
    assert.equal(result.providerKind, "mock");
    assert.notEqual(result.insight.generatedAt, expiredGeneratedAt);
    assert.equal(result.insight.model, TRACKER_MODEL);

    await deleteTestInsight();
  });

  it("returns safe cooldown message without secrets", () => {
    const message = getSafeAiRefreshErrorMessage("AI_REFRESH_COOLDOWN");
    assert.equal(message.includes("Bearer"), false);
    assert.equal(message.includes("sk-"), false);
    assert.equal(message.includes("503"), false);
    assert.equal(message.length > 0, true);
  });
});
