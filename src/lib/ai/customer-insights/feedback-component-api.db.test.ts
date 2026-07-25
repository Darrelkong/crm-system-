import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import type { User } from "../../../../drizzle/schema/users";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { ensureAiInsightFeedbackPhase5dMigrationForTests } from "@/lib/ai/customer-insights/test-helpers/ensure-feedback-phase5d-migration";
import {
  ComponentFeedbackApiError,
  getComponentFeedbackForActor,
  putComponentFeedbackForActor,
  assertComponentFeedbackSafeResponseKeys,
} from "@/lib/ai/customer-insights/feedback-component-api";
import {
  getCustomerAiInsightFeedbackForAdmin,
  upsertCustomerAiInsightFeedbackForAdmin,
} from "@/lib/ai/customer-insights/feedback-api";
import { serializePhase2Insight } from "@/lib/ai/customer-insights/phase2-compose";
import { PHASE2_VERSION } from "@/lib/ai/phase2/types";
import type { Phase2Insight } from "@/lib/ai/phase2/types";
import { PermissionError } from "@/lib/permissions/customers";
import { writeAuditLog } from "@/lib/audit/audit-log";
import {
  AI_FEEDBACK_COMPONENT_AUDIT_CREATED,
  AI_FEEDBACK_COMPONENT_AUDIT_UPDATED,
} from "@/lib/ai/customer-insights/feedback-component-audit";
import { PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER } from "@/lib/ai/customer-insights/safe-suggested-message";
import { listFeedbackForGeneration } from "@/lib/ai/customer-insights/feedback-repository";
import { buildAiInsightGenerationKey } from "@/lib/ai/customer-insights/feedback-generation-key";
import { resolveComponentFeedbackSnapshots } from "@/lib/ai/customer-insights/feedback-component-snapshot";
import { getCustomerAiInsightByCustomerId } from "@/lib/ai/customer-insights/service";

const TEST_INSIGHT_ID = "ai999999-9999-9999-9999-9999999995d2";
const TEST_INSIGHT_OTHER = "ai999999-9999-9999-9999-9999999995d3";
const TEST_ASSIGNEE_ROW_ID = "aa999999-9999-9999-9999-9999999995d2";
const TEST_CUSTOMER_ID = SEED_IDS.customerStaffA;
const OTHER_CUSTOMER_ID = SEED_IDS.customerStaffB;
const GENERATED_AT = "2026-07-20T12:00:00.000Z";
const GENERATED_AT_B = "2026-07-20T13:00:00.000Z";
const SOURCE_HASH = "phase5d2-source-hash";
const SOURCE_HASH_B = "phase5d2-source-hash-b";
const SHARED_HASH = "phase5d2-shared-cross-customer-hash";

let db: ReturnType<typeof drizzle<typeof schema>>;
let adminUser: User;
let staffA: User;
let staffB: User;
let disposeProxy: (() => Promise<void>) | undefined;

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
      summary: "Insufficient",
    },
    followUpRecommendation: {
      date: null,
      timeWindow: null,
      channel: null,
      topic: null,
      confidence: "low",
      basis: [],
      insufficientDataReason: "none",
    },
    missingInformation: [],
  };
}

async function deleteTestRows() {
  await db
    .delete(schema.aiInsightFeedback)
    .where(eq(schema.aiInsightFeedback.customerId, TEST_CUSTOMER_ID));
  await db
    .delete(schema.aiInsightFeedback)
    .where(eq(schema.aiInsightFeedback.customerId, OTHER_CUSTOMER_ID));
  await db
    .delete(schema.customerAiInsights)
    .where(eq(schema.customerAiInsights.customerId, TEST_CUSTOMER_ID));
  await db
    .delete(schema.customerAiInsights)
    .where(eq(schema.customerAiInsights.customerId, OTHER_CUSTOMER_ID));
  await db
    .delete(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.entityType, "customer"),
        eq(schema.auditLogs.entityId, TEST_CUSTOMER_ID),
      ),
    );
  await db
    .delete(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.entityType, "customer"),
        eq(schema.auditLogs.entityId, OTHER_CUSTOMER_ID),
      ),
    );
  await db
    .delete(schema.customerAssignees)
    .where(eq(schema.customerAssignees.id, TEST_ASSIGNEE_ROW_ID));
}

async function insertReadyInsight(options?: {
  phase2?: boolean;
  message?: string;
  status?: "ready" | "failed";
  generatedAt?: string;
  sourceHash?: string;
  model?: string;
  insightId?: string;
  customerId?: string;
}) {
  const generatedAt = options?.generatedAt ?? GENERATED_AT;
  const sourceHash = options?.sourceHash ?? SOURCE_HASH;
  const ts = "2026-07-20T11:00:00.000Z";
  const customerId = options?.customerId ?? TEST_CUSTOMER_ID;
  await db.insert(schema.customerAiInsights).values({
    id: options?.insightId ?? TEST_INSIGHT_ID,
    customerId,
    intentLevel: "medium",
    intentScore: 55,
    customerSummary: "5D-2 summary",
    currentSituation: "5D-2 situation",
    keySignalsJson: "[]",
    riskFlagsJson: "[]",
    missingInformationJson: "[]",
    nextBestAction: "Follow up",
    suggestedFollowUpAt: null,
    suggestedEmployeeMessage: options?.message ?? "你好，想跟进一下项目。",
    confidence: 0.7,
    reasoning: "5D-2 reasoning",
    model: options?.model ?? "gemini-2.5-flash",
    promptVersion: "phase-5d2-v1",
    sourceHash,
    status: options?.status ?? "ready",
    generatedAt,
    createdAt: ts,
    updatedAt: generatedAt,
    phase2Json: options?.phase2 ? serializePhase2Insight(minimalPhase2()) : null,
  });
}

async function insertRefreshAudit(
  providerKind: string,
  sourceHash = SOURCE_HASH,
  customerId: string = TEST_CUSTOMER_ID,
  generatedAt?: string,
) {
  await writeAuditLog(
    {
      userId: adminUser.id,
      action: "customer.ai_insight.refreshed",
      entityType: "customer",
      entityId: customerId,
      metadata: {
        customerId,
        sourceHash,
        ...(generatedAt ? { generatedAt } : {}),
        model: "gemini-2.5-flash",
        promptVersion: "phase-5d2-v1",
        status: "ready",
        providerKind,
        phase2Generated: false,
        phase2UnavailableReason: "missing_signals",
      },
    },
    db,
  );
}

function assertSafeResponseKeys(payload: Parameters<
  typeof assertComponentFeedbackSafeResponseKeys
>[0]) {
  assertComponentFeedbackSafeResponseKeys(payload);
  const forbiddenLeaf = [
    "customerName",
    "staffName",
    "actorId",
    "actorUserId",
    "createdBy",
    "updatedBy",
    "aiInsightId",
    "generationKey",
    "providerSnapshot",
    "modelSnapshot",
    "promptVersionSnapshot",
    "contractModeSnapshot",
    "degradationReasonSnapshot",
    "sourceId",
    "evidence",
    "comment",
    "suggestedEmployeeMessage",
    "phone",
    "email",
    "wechat",
    "wechatId",
  ];
  const json = JSON.stringify(payload);
  for (const key of forbiddenLeaf) {
    assert.equal(
      json.includes(`"${key}"`),
      false,
      `response must not include key ${key}`,
    );
  }
}

describe("Phase 5D-2 component feedback API (local D1)", () => {
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

    const [admin] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.admin))
      .limit(1);
    const [a] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.staffA))
      .limit(1);
    const [b] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.staffB))
      .limit(1);
    assert.ok(admin && a && b);
    adminUser = admin;
    staffA = a;
    staffB = b;
  });

  beforeEach(async () => {
    await deleteTestRows();
  });

  after(async () => {
    await deleteTestRows();
    bindTestDatabase(null);
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    await disposeProxy?.();
  });

  it("GET returns unavailable state when insight missing", async () => {
    const result = await getComponentFeedbackForActor(
      db,
      staffA,
      TEST_CUSTOMER_ID,
    );
    assert.equal(result.ok, true);
    assert.equal(result.generation, null);
    assert.equal(result.eligibility.baseDeep, false);
    assert.equal(result.feedback.baseDeep, null);
    assertSafeResponseKeys(result);
  });

  it("owner staff can PUT base_deep and GET own feedback only", async () => {
    await insertReadyInsight();
    await insertRefreshAudit("google_gemini");

    const put = await putComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID, {
      insightGeneratedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
      target: "base_deep",
      rating: "helpful",
      tags: ["accurate_summary"],
    });
    assert.equal(put.created, true);
    assert.equal(put.response.feedback.baseDeep?.rating, "helpful");
    assert.equal(put.feedback.providerSnapshot, "google_gemini");
    assert.equal(put.feedback.contractModeSnapshot, "gemini_flat");
    assert.equal(put.feedback.phase2GeneratedSnapshot, false);
    assert.equal(put.feedback.actorRoleSnapshot, "staff");
    assertSafeResponseKeys(put.response);

    const getOwn = await getComponentFeedbackForActor(
      db,
      staffA,
      TEST_CUSTOMER_ID,
    );
    assert.equal(getOwn.feedback.baseDeep?.rating, "helpful");

    await assert.rejects(
      () => getComponentFeedbackForActor(db, staffB, TEST_CUSTOMER_ID),
      (err: unknown) => err instanceof PermissionError,
    );
  });

  it("rejects other staff without customer view permission", async () => {
    await insertReadyInsight();
    await assert.rejects(
      () =>
        putComponentFeedbackForActor(db, staffB, TEST_CUSTOMER_ID, {
          insightGeneratedAt: GENERATED_AT,
          sourceHash: SOURCE_HASH,
          target: "base_deep",
          rating: "helpful",
          tags: [],
        }),
      (err: unknown) => err instanceof PermissionError,
    );
  });

  it("rejects generation mismatch without writing rows", async () => {
    await insertReadyInsight();
    await assert.rejects(
      () =>
        putComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID, {
          insightGeneratedAt: GENERATED_AT,
          sourceHash: "stale-hash",
          target: "base_deep",
          rating: "helpful",
          tags: [],
        }),
      (err: unknown) =>
        err instanceof ComponentFeedbackApiError &&
        err.errorCode === "AI_FEEDBACK_GENERATION_MISMATCH" &&
        err.status === 409,
    );

    const rows = await db
      .select()
      .from(schema.aiInsightFeedback)
      .where(eq(schema.aiInsightFeedback.customerId, TEST_CUSTOMER_ID));
    assert.equal(rows.length, 0);
  });

  it("rejects phase2 target when degraded / null", async () => {
    await insertReadyInsight({ phase2: false });
    await assert.rejects(
      () =>
        putComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID, {
          insightGeneratedAt: GENERATED_AT,
          sourceHash: SOURCE_HASH,
          target: "phase2",
          rating: "helpful",
          tags: [],
        }),
      (err: unknown) =>
        err instanceof ComponentFeedbackApiError &&
        err.errorCode === "AI_FEEDBACK_TARGET_NOT_ELIGIBLE",
    );
  });

  it("allows phase2 when renderable phase2_json present", async () => {
    await insertReadyInsight({ phase2: true });
    await insertRefreshAudit("openai_compatible");
    const put = await putComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID, {
      insightGeneratedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
      target: "phase2",
      rating: "not_helpful",
      tags: ["missing_evidence"],
    });
    assert.equal(put.created, true);
    assert.equal(put.feedback.phase2GeneratedSnapshot, true);
    assert.equal(put.feedback.providerSnapshot, "openai_compatible");
    assert.equal(put.feedback.contractModeSnapshot, "rich");
  });

  it("rejects suggested_message when placeholder suppressed", async () => {
    await insertReadyInsight({
      message: PHASE2_SAFE_SUGGESTED_MESSAGE_PLACEHOLDER,
    });
    await assert.rejects(
      () =>
        putComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID, {
          insightGeneratedAt: GENERATED_AT,
          sourceHash: SOURCE_HASH,
          target: "suggested_message",
          rating: "helpful",
          tags: [],
        }),
      (err: unknown) =>
        err instanceof ComponentFeedbackApiError &&
        err.errorCode === "AI_FEEDBACK_TARGET_NOT_ELIGIBLE",
    );
  });

  it("uses unknown provider snapshot when refresh audit missing", async () => {
    await insertReadyInsight();
    const put = await putComponentFeedbackForActor(db, adminUser, TEST_CUSTOMER_ID, {
      insightGeneratedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
      target: "base_deep",
      rating: "helpful",
      tags: [],
    });
    assert.equal(put.feedback.providerSnapshot, "unknown");
    assert.equal(put.feedback.contractModeSnapshot, "unknown");
    assert.equal(put.feedback.model, "gemini-2.5-flash");
    assert.equal(put.feedback.actorRoleSnapshot, "admin");
  });

  it("updates own feedback and keeps actor/generation isolation", async () => {
    await insertReadyInsight();
    await insertRefreshAudit("google_gemini");

    const created = await putComponentFeedbackForActor(
      db,
      staffA,
      TEST_CUSTOMER_ID,
      {
        insightGeneratedAt: GENERATED_AT,
        sourceHash: SOURCE_HASH,
        target: "base_deep",
        rating: "helpful",
        tags: [],
      },
    );
    const updated = await putComponentFeedbackForActor(
      db,
      staffA,
      TEST_CUSTOMER_ID,
      {
        insightGeneratedAt: GENERATED_AT,
        sourceHash: SOURCE_HASH,
        target: "base_deep",
        rating: "not_helpful",
        tags: ["too_generic"],
      },
    );
    assert.equal(created.created, true);
    assert.equal(updated.created, false);
    assert.equal(updated.feedback.id, created.feedback.id);
    assert.equal(updated.feedback.createdAt, created.feedback.createdAt);
    assert.equal(updated.feedback.ratingCode, "not_helpful");

    const adminPut = await putComponentFeedbackForActor(
      db,
      adminUser,
      TEST_CUSTOMER_ID,
      {
        insightGeneratedAt: GENERATED_AT,
        sourceHash: SOURCE_HASH,
        target: "base_deep",
        rating: "helpful",
        tags: ["saves_time"],
      },
    );
    assert.equal(adminPut.created, true);
    assert.notEqual(adminPut.feedback.id, created.feedback.id);

    const staffGet = await getComponentFeedbackForActor(
      db,
      staffA,
      TEST_CUSTOMER_ID,
    );
    assert.equal(staffGet.feedback.baseDeep?.rating, "not_helpful");
    assert.deepEqual(staffGet.feedback.baseDeep?.tags, ["too_generic"]);

    const adminGet = await getComponentFeedbackForActor(
      db,
      adminUser,
      TEST_CUSTOMER_ID,
    );
    assert.equal(adminGet.feedback.baseDeep?.rating, "helpful");
  });

  it("coexists with legacy admin feedback without leaking comment", async () => {
    await insertReadyInsight();
    await upsertCustomerAiInsightFeedbackForAdmin(
      db,
      adminUser,
      TEST_CUSTOMER_ID,
      {
        insightGeneratedAt: GENERATED_AT,
        rating: 4,
        reasonTags: ["too_long"],
        comment: "legacy secret comment",
      },
    );

    await putComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID, {
      insightGeneratedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
      target: "base_deep",
      rating: "helpful",
      tags: [],
    });

    const componentGet = await getComponentFeedbackForActor(
      db,
      staffA,
      TEST_CUSTOMER_ID,
    );
    assertSafeResponseKeys(componentGet);
    assert.equal(
      JSON.stringify(componentGet).includes("legacy secret comment"),
      false,
    );

    const legacy = await getCustomerAiInsightFeedbackForAdmin(
      db,
      adminUser,
      TEST_CUSTOMER_ID,
    );
    assert.equal(legacy.feedback?.rating, 4);
    assert.equal(legacy.feedback?.comment, "legacy secret comment");

    const generationKey = buildAiInsightGenerationKey({
      aiInsightId: TEST_INSIGHT_ID,
      insightGeneratedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
    });
    const componentRows = await listFeedbackForGeneration(db, generationKey);
    assert.equal(componentRows.length, 1);
  });

  it("does not mutate insight row on component PUT", async () => {
    await insertReadyInsight({ phase2: true });
    const before = await db
      .select()
      .from(schema.customerAiInsights)
      .where(eq(schema.customerAiInsights.id, TEST_INSIGHT_ID))
      .limit(1);

    await putComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID, {
      insightGeneratedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
      target: "base_deep",
      rating: "helpful",
      tags: [],
    });

    const after = await db
      .select()
      .from(schema.customerAiInsights)
      .where(eq(schema.customerAiInsights.id, TEST_INSIGHT_ID))
      .limit(1);
    assert.deepEqual(after[0], before[0]);
  });

  it("records create/update audit without sensitive fields", async () => {
    await insertReadyInsight();
    const created = await putComponentFeedbackForActor(
      db,
      staffA,
      TEST_CUSTOMER_ID,
      {
        insightGeneratedAt: GENERATED_AT,
        sourceHash: SOURCE_HASH,
        target: "base_deep",
        rating: "helpful",
        tags: ["accurate_summary"],
      },
    );

    await writeAuditLog(
      {
        userId: staffA.id,
        action: AI_FEEDBACK_COMPONENT_AUDIT_CREATED,
        entityType: "customer",
        entityId: TEST_CUSTOMER_ID,
        metadata: {
          feedbackTarget: created.feedback.feedbackTarget,
          ratingCode: created.feedback.ratingCode,
          reasonTagCodes: created.feedback.reasonTags,
          reasonTagCount: created.feedback.reasonTags.length,
          insightGeneratedAt: created.feedback.insightGeneratedAt,
          phase2Generated: created.feedback.phase2GeneratedSnapshot,
          providerSnapshot: created.feedback.providerSnapshot,
          contractModeSnapshot: created.feedback.contractModeSnapshot,
          operation: "create",
        },
      },
      db,
    );

    await putComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID, {
      insightGeneratedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
      target: "base_deep",
      rating: "not_helpful",
      tags: [],
    });

    await writeAuditLog(
      {
        userId: staffA.id,
        action: AI_FEEDBACK_COMPONENT_AUDIT_UPDATED,
        entityType: "customer",
        entityId: TEST_CUSTOMER_ID,
        metadata: {
          feedbackTarget: "base_deep",
          ratingCode: "not_helpful",
          reasonTagCodes: [],
          reasonTagCount: 0,
          insightGeneratedAt: GENERATED_AT,
          phase2Generated: false,
          providerSnapshot: "unknown",
          contractModeSnapshot: "unknown",
          operation: "update",
        },
      },
      db,
    );

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, TEST_CUSTOMER_ID),
          eq(schema.auditLogs.action, AI_FEEDBACK_COMPONENT_AUDIT_CREATED),
        ),
      );
    assert.ok(audits.length >= 1);
    const meta = audits[0]!.metadata ?? "";
    assert.equal(meta.includes(SOURCE_HASH), false);
    assert.equal(meta.includes("generationKey"), false);
  });

  it("rejects failed insight submissions", async () => {
    await insertReadyInsight({ status: "failed" });
    await assert.rejects(
      () =>
        putComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID, {
          insightGeneratedAt: GENERATED_AT,
          sourceHash: SOURCE_HASH,
          target: "base_deep",
          rating: "helpful",
          tags: [],
        }),
      (err: unknown) =>
        err instanceof ComponentFeedbackApiError &&
        err.errorCode === "AI_FEEDBACK_INSIGHT_NOT_READY",
    );
  });

  it("does not touch unrelated customers", async () => {
    await insertReadyInsight();
    await assert.rejects(
      () =>
        putComponentFeedbackForActor(db, staffA, OTHER_CUSTOMER_ID, {
          insightGeneratedAt: GENERATED_AT,
          sourceHash: SOURCE_HASH,
          target: "base_deep",
          rating: "helpful",
          tags: [],
        }),
      (err: unknown) =>
        err instanceof ComponentFeedbackApiError ||
        err instanceof PermissionError,
    );
  });

  it("assignee staff can GET/PUT; removal immediately denies", async () => {
    await insertReadyInsight();
    const now = new Date().toISOString();
    await db.insert(schema.customerAssignees).values({
      id: TEST_ASSIGNEE_ROW_ID,
      customerId: TEST_CUSTOMER_ID,
      userId: staffB.id,
      role: "collaborator",
      assignedBy: adminUser.id,
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const getAllowed = await getComponentFeedbackForActor(
      db,
      staffB,
      TEST_CUSTOMER_ID,
    );
    assert.equal(getAllowed.ok, true);
    assert.equal(getAllowed.eligibility.baseDeep, true);

    const put = await putComponentFeedbackForActor(db, staffB, TEST_CUSTOMER_ID, {
      insightGeneratedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
      target: "base_deep",
      rating: "helpful",
      tags: ["saves_time"],
    });
    assert.equal(put.created, true);
    assert.equal(put.feedback.createdBy, staffB.id);

    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.id, TEST_ASSIGNEE_ROW_ID));

    await assert.rejects(
      () => getComponentFeedbackForActor(db, staffB, TEST_CUSTOMER_ID),
      (err: unknown) => err instanceof PermissionError,
    );
    await assert.rejects(
      () =>
        putComponentFeedbackForActor(db, staffB, TEST_CUSTOMER_ID, {
          insightGeneratedAt: GENERATED_AT,
          sourceHash: SOURCE_HASH,
          target: "base_deep",
          rating: "not_helpful",
          tags: [],
        }),
      (err: unknown) => err instanceof PermissionError,
    );

    // Existing historical row remains; owner can still read own (not assignee's).
    const ownerGet = await getComponentFeedbackForActor(
      db,
      staffA,
      TEST_CUSTOMER_ID,
    );
    assert.equal(ownerGet.feedback.baseDeep, null);
  });

  it("public pool masked denies staff GET/PUT", async () => {
    await insertReadyInsight();
    const [before] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, TEST_CUSTOMER_ID))
      .limit(1);
    assert.ok(before);

    await db
      .update(schema.customers)
      .set({
        status: "public_pool",
        ownerId: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.customers.id, TEST_CUSTOMER_ID));

    try {
      await assert.rejects(
        () => getComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID),
        (err: unknown) => err instanceof PermissionError,
      );
      await assert.rejects(
        () =>
          putComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID, {
            insightGeneratedAt: GENERATED_AT,
            sourceHash: SOURCE_HASH,
            target: "base_deep",
            rating: "helpful",
            tags: [],
          }),
        (err: unknown) => err instanceof PermissionError,
      );
    } finally {
      await db
        .update(schema.customers)
        .set({
          status: before.status,
          ownerId: before.ownerId,
          updatedAt: before.updatedAt,
        })
        .where(eq(schema.customers.id, TEST_CUSTOMER_ID));
    }
  });

  it("transferred former owner loses GET/PUT", async () => {
    await insertReadyInsight();
    const [before] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, TEST_CUSTOMER_ID))
      .limit(1);
    assert.ok(before);
    assert.equal(before.ownerId, staffA.id);

    const priorAssignees = await db
      .select()
      .from(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, TEST_CUSTOMER_ID));

    await db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, TEST_CUSTOMER_ID));
    await db
      .update(schema.customers)
      .set({
        ownerId: staffB.id,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.customers.id, TEST_CUSTOMER_ID));

    try {
      await assert.rejects(
        () => getComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID),
        (err: unknown) => err instanceof PermissionError,
      );
      await assert.rejects(
        () =>
          putComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID, {
            insightGeneratedAt: GENERATED_AT,
            sourceHash: SOURCE_HASH,
            target: "base_deep",
            rating: "helpful",
            tags: [],
          }),
        (err: unknown) => err instanceof PermissionError,
      );

      const newOwner = await getComponentFeedbackForActor(
        db,
        staffB,
        TEST_CUSTOMER_ID,
      );
      assert.equal(newOwner.eligibility.baseDeep, true);
    } finally {
      await db
        .delete(schema.customerAssignees)
        .where(eq(schema.customerAssignees.customerId, TEST_CUSTOMER_ID));
      if (priorAssignees.length > 0) {
        await db.insert(schema.customerAssignees).values(priorAssignees);
      }
      await db
        .update(schema.customers)
        .set({
          ownerId: before.ownerId,
          updatedAt: before.updatedAt,
        })
        .where(eq(schema.customers.id, TEST_CUSTOMER_ID));
    }
  });

  it("generation race after refresh writes nothing", async () => {
    await insertReadyInsight();
    const generationA = {
      insightGeneratedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
    };

    await db
      .update(schema.customerAiInsights)
      .set({
        generatedAt: GENERATED_AT_B,
        sourceHash: SOURCE_HASH_B,
        updatedAt: GENERATED_AT_B,
      })
      .where(eq(schema.customerAiInsights.id, TEST_INSIGHT_ID));

    await assert.rejects(
      () =>
        putComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID, {
          ...generationA,
          target: "base_deep",
          rating: "helpful",
          tags: [],
        }),
      (err: unknown) =>
        err instanceof ComponentFeedbackApiError &&
        err.errorCode === "AI_FEEDBACK_GENERATION_MISMATCH",
    );

    const rows = await db
      .select()
      .from(schema.aiInsightFeedback)
      .where(eq(schema.aiInsightFeedback.customerId, TEST_CUSTOMER_ID));
    assert.equal(rows.length, 0);

    const componentAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, TEST_CUSTOMER_ID),
          eq(schema.auditLogs.action, AI_FEEDBACK_COMPONENT_AUDIT_CREATED),
        ),
      );
    assert.equal(componentAudits.length, 0);

    const insight = await getCustomerAiInsightByCustomerId(db, TEST_CUSTOMER_ID);
    assert.equal(insight?.generatedAt, GENERATED_AT_B);
    assert.equal(insight?.sourceHash, SOURCE_HASH_B);
  });

  it("snapshot matches exact generation A/B and isolates cross-customer hash", async () => {
    await insertReadyInsight({
      generatedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
    });
    await insertRefreshAudit("google_gemini", SOURCE_HASH, TEST_CUSTOMER_ID);
    await insertRefreshAudit(
      "openai_compatible",
      SOURCE_HASH_B,
      TEST_CUSTOMER_ID,
    );
    // Failed refresh must never be used even with same hash.
    await writeAuditLog(
      {
        userId: adminUser.id,
        action: "customer.ai_insight.refresh_failed",
        entityType: "customer",
        entityId: TEST_CUSTOMER_ID,
        metadata: {
          customerId: TEST_CUSTOMER_ID,
          sourceHash: SOURCE_HASH,
          providerKind: "mock",
        },
      },
      db,
    );
    // Other customer shares the same sourceHash with a different provider.
    await insertReadyInsight({
      insightId: TEST_INSIGHT_OTHER,
      customerId: OTHER_CUSTOMER_ID,
      generatedAt: GENERATED_AT,
      sourceHash: SOURCE_HASH,
    });
    await insertRefreshAudit(
      "openai_compatible",
      SOURCE_HASH,
      OTHER_CUSTOMER_ID,
    );

    const insightA = await getCustomerAiInsightByCustomerId(
      db,
      TEST_CUSTOMER_ID,
    );
    assert.ok(insightA);
    const snapA = await resolveComponentFeedbackSnapshots(db, staffA, insightA);
    assert.equal(snapA.providerSnapshot, "google_gemini");
    assert.equal(snapA.contractModeSnapshot, "gemini_flat");

    await db
      .update(schema.customerAiInsights)
      .set({
        generatedAt: GENERATED_AT_B,
        sourceHash: SOURCE_HASH_B,
        updatedAt: GENERATED_AT_B,
      })
      .where(eq(schema.customerAiInsights.id, TEST_INSIGHT_ID));

    const insightB = await getCustomerAiInsightByCustomerId(
      db,
      TEST_CUSTOMER_ID,
    );
    assert.ok(insightB);
    const snapB = await resolveComponentFeedbackSnapshots(db, staffA, insightB);
    assert.equal(snapB.providerSnapshot, "openai_compatible");
    assert.equal(snapB.contractModeSnapshot, "rich");

    const otherInsight = await getCustomerAiInsightByCustomerId(
      db,
      OTHER_CUSTOMER_ID,
    );
    assert.ok(otherInsight);
    const otherSnap = await resolveComponentFeedbackSnapshots(
      db,
      adminUser,
      otherInsight,
    );
    assert.equal(otherSnap.providerSnapshot, "openai_compatible");

    // Shared hash fixture for explicit isolation check.
    await db
      .update(schema.customerAiInsights)
      .set({ sourceHash: SHARED_HASH, updatedAt: GENERATED_AT })
      .where(eq(schema.customerAiInsights.id, TEST_INSIGHT_ID));
    await insertRefreshAudit("mock", SHARED_HASH, OTHER_CUSTOMER_ID);
    const sharedInsight = await getCustomerAiInsightByCustomerId(
      db,
      TEST_CUSTOMER_ID,
    );
    assert.ok(sharedInsight);
    const sharedSnap = await resolveComponentFeedbackSnapshots(
      db,
      staffA,
      sharedInsight,
    );
    assert.equal(sharedSnap.providerSnapshot, "unknown");
  });

  it("rejects generatedAt mismatch with same sourceHash", async () => {
    await insertReadyInsight();
    await assert.rejects(
      () =>
        putComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID, {
          insightGeneratedAt: GENERATED_AT_B,
          sourceHash: SOURCE_HASH,
          target: "base_deep",
          rating: "helpful",
          tags: [],
        }),
      (err: unknown) =>
        err instanceof ComponentFeedbackApiError &&
        err.errorCode === "AI_FEEDBACK_GENERATION_MISMATCH",
    );
  });

  it("rejects suggested_message when draft setting is off", async () => {
    await insertReadyInsight();
    const [setting] = await db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, "ai_show_draft_message"))
      .limit(1);
    const previous = setting?.value ?? "true";
    const now = new Date().toISOString();

    if (setting) {
      await db
        .update(schema.systemSettings)
        .set({ value: "false", updatedAt: now })
        .where(eq(schema.systemSettings.key, "ai_show_draft_message"));
    } else {
      await db.insert(schema.systemSettings).values({
        key: "ai_show_draft_message",
        value: "false",
        updatedAt: now,
        updatedBy: adminUser.id,
      });
    }

    try {
      const get = await getComponentFeedbackForActor(
        db,
        staffA,
        TEST_CUSTOMER_ID,
      );
      assert.equal(get.eligibility.suggestedMessage, false);
      await assert.rejects(
        () =>
          putComponentFeedbackForActor(db, staffA, TEST_CUSTOMER_ID, {
            insightGeneratedAt: GENERATED_AT,
            sourceHash: SOURCE_HASH,
            target: "suggested_message",
            rating: "helpful",
            tags: [],
          }),
        (err: unknown) =>
          err instanceof ComponentFeedbackApiError &&
          err.errorCode === "AI_FEEDBACK_TARGET_NOT_ELIGIBLE",
      );
    } finally {
      if (setting) {
        await db
          .update(schema.systemSettings)
          .set({ value: previous, updatedAt: new Date().toISOString() })
          .where(eq(schema.systemSettings.key, "ai_show_draft_message"));
      } else {
        await db
          .delete(schema.systemSettings)
          .where(eq(schema.systemSettings.key, "ai_show_draft_message"));
      }
    }
  });
});
