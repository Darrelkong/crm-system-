import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateAdminBriefContext,
  validateAdminBriefLocale,
} from "../src/validate-admin-context";
import { validateAdminBriefOutput } from "../src/validate-admin-output";
import {
  handleCrmAiRequest,
  parseCrmAiRequestBody,
  runAdminManagementBrief,
} from "../src/service";
import { ADMIN_MANAGEMENT_BRIEF_PROMPT_VERSION } from "../src/admin-brief";
import { MODEL_QWEN } from "../src/models";
import type { CrmAiEnv } from "../src/types";

const validContext = {
  metrics: {
    newCustomersToday: 1,
    validFollowUpsToday: 2,
    pendingApprovals: 3,
    autoReleaseWithin7Days: 4,
    autoReleaseTomorrow: 0,
    overdueFollowUps: 1,
    publicPoolEnteredToday: 0,
    totalCustomers: 10,
  },
  teamAggregates: {
    activeStaffCount: 2,
    staffWithOverdueCount: 1,
    staffWithReclamationRiskCount: 0,
    teamPendingItemsTotal: 1,
    teamCurrentCustomersTotal: 10,
  },
  reclamationRisk: {
    tomorrowCount: 0,
    within7Count: 4,
    membersAtRiskCount: 0,
    pendingRiskCount: 0,
  },
  stageDistribution: [{ stageKey: "negotiation", count: 5, percentage: 50 }],
  trendSummary: {
    validFollowUpsLast7Days: 10,
    newCustomersLast7Days: 3,
    stageProgressLast7Days: 2,
  },
};

const validOutput = {
  headline: "管理摘要",
  summary: "今日运营整体稳定。",
  priorities: [
    {
      category: "approvals",
      title: "处理审批",
      reason: "当前有 3 项待审批。",
      urgency: "attention",
    },
  ],
  cautions: ["本摘要基于系统数据。"],
};

function makeEnv(
  runImpl: (model: string, payload: unknown, options: unknown) => Promise<unknown>,
): CrmAiEnv {
  return {
    AI: {
      run: runImpl,
    } as unknown as Ai,
  };
}

describe("admin_management_brief input validation", () => {
  it("accepts valid aggregate context", () => {
    assert.ok(validateAdminBriefContext(validContext));
    assert.equal(validateAdminBriefLocale("zh-Hans"), "zh-Hans");
  });

  it("rejects unexpected keys and pii-like fields", () => {
    assert.equal(validateAdminBriefContext({ ...validContext, customerName: "x" }), null);
    assert.equal(
      validateAdminBriefContext({
        ...validContext,
        metrics: { ...validContext.metrics, email: "a@b.com" },
      }),
      null,
    );
    assert.equal(validateAdminBriefContext(null), null);
  });

  it("parses valid admin request bodies", () => {
    assert.deepEqual(
      parseCrmAiRequestBody({
        task: "admin_management_brief",
        schemaVersion: ADMIN_MANAGEMENT_BRIEF_PROMPT_VERSION,
        locale: "zh-Hans",
        context: validContext,
      }),
      {
        task: "admin_management_brief",
        schemaVersion: ADMIN_MANAGEMENT_BRIEF_PROMPT_VERSION,
        locale: "zh-Hans",
        context: validContext,
      },
    );
  });

  it("rejects invalid schemaVersion and malformed context", () => {
    assert.equal(
      parseCrmAiRequestBody({
        task: "admin_management_brief",
        schemaVersion: "bad",
        locale: "zh-Hans",
        context: validContext,
      }),
      null,
    );
    assert.equal(
      parseCrmAiRequestBody({
        task: "admin_management_brief",
        schemaVersion: ADMIN_MANAGEMENT_BRIEF_PROMPT_VERSION,
        locale: "zh-Hans",
        context: { metrics: { pendingApprovals: -1 } },
      }),
      null,
    );
  });
});

describe("admin_management_brief output validation", () => {
  it("accepts structured admin brief output", () => {
    assert.equal(validateAdminBriefOutput(validOutput), true);
  });

  it("rejects malformed output", () => {
    assert.equal(validateAdminBriefOutput({ headline: "x" }), false);
    assert.equal(
      validateAdminBriefOutput({
        ...validOutput,
        priorities: [{ category: "bad", title: "x", reason: "y", urgency: "normal" }],
      }),
      false,
    );
  });
});

describe("admin_management_brief service", () => {
  it("returns structured success from Workers AI wrapper", async () => {
    const env = makeEnv(async () => ({ response: validOutput }));
    const result = await handleCrmAiRequest(env, {
      task: "admin_management_brief",
      schemaVersion: ADMIN_MANAGEMENT_BRIEF_PROMPT_VERSION,
      locale: "zh-Hans",
      context: validContext,
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("expected success");
    assert.equal(result.model, MODEL_QWEN);
    assert.equal(result.data.headline, validOutput.headline);
  });

  it("retries once on invalid_output but not on timeout", async () => {
    let calls = 0;
    const env = makeEnv(async () => {
      calls += 1;
      if (calls === 1) {
        return { response: { headline: "bad" } };
      }
      return { response: validOutput };
    });

    const result = await runAdminManagementBrief(env, {
      task: "admin_management_brief",
      schemaVersion: ADMIN_MANAGEMENT_BRIEF_PROMPT_VERSION,
      locale: "zh-Hans",
      context: validContext,
    });
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
  });

  it("does not double-wait on timeout within total deadline", async () => {
    let calls = 0;
    const env: CrmAiEnv = {
      AI: {
        run: async () => {
          calls += 1;
          return new Promise(() => {});
        },
      } as unknown as Ai,
      CRM_AI_TIMEOUT_MS: "200",
    };

    const startedAt = Date.now();
    const result = await runAdminManagementBrief(env, {
      task: "admin_management_brief",
      schemaVersion: ADMIN_MANAGEMENT_BRIEF_PROMPT_VERSION,
      locale: "zh-Hans",
      context: validContext,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected failure");
    assert.equal(result.error, "timeout");
    assert.equal(calls, 1);
    assert.ok(Date.now() - startedAt < 500);
  });
});
