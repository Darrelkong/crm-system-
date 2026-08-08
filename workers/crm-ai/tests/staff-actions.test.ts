import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateStaffActionsContext,
  validateStaffActionsLocale,
} from "../src/validate-staff-context";
import { validateStaffActionsOutput } from "../src/validate-staff-output";
import {
  handleCrmAiRequest,
  parseCrmAiRequestBody,
  runStaffTodayActions,
} from "../src/service";
import { STAFF_TODAY_ACTIONS_PROMPT_VERSION } from "../src/staff-actions";
import { MODEL_QWEN } from "../src/models";
import type { CrmAiEnv } from "../src/types";

const validContext = {
  metrics: {
    dueTodayFollowUps: 1,
    overdueFollowUps: 1,
    autoReleaseWithin7Days: 2,
    autoReleaseTomorrow: 0,
    pendingWorkItems: 1,
    validFollowUpsToday: 2,
    myCustomerCount: 5,
  },
  reclamationRisk: {
    tomorrowCount: 0,
    within7Count: 2,
    pendingRiskCount: 0,
  },
  stageDistribution: [{ stageKey: "negotiation", count: 2, percentage: 40 }],
  trendSummary: {
    validFollowUpsLast7Days: 8,
    newCustomersLast7Days: 1,
  },
  customers: [
    {
      ref: "C1",
      stage: "negotiation",
      followUpStatus: "overdue",
      overdueHours: 12,
      pendingActions: ["follow_up"],
    },
    {
      ref: "C2",
      stage: "contacted",
      followUpStatus: "due_today",
      reclamationDaysRemaining: 3,
      pendingActions: ["reclamation"],
    },
  ],
};

const validOutput = {
  headline: "今日优先事项",
  actions: [
    {
      customerRef: "C1",
      category: "overdue",
      title: "优先跟进 C1",
      reason: "该客户已逾期跟进。",
      urgency: "urgent",
    },
    {
      category: "work_item",
      title: "处理待办",
      reason: "你当前有 1 项待处理事项。",
      urgency: "attention",
    },
  ],
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

describe("staff_today_actions input validation", () => {
  it("accepts valid staff aggregate context", () => {
    const validated = validateStaffActionsContext(validContext);
    assert.ok(validated);
    assert.equal(validated?.allowedCustomerRefs.has("C1"), true);
    assert.equal(validated?.allowedCustomerRefs.has("C2"), true);
    assert.equal(validateStaffActionsLocale("zh-Hans"), "zh-Hans");
  });

  it("rejects forbidden keys and invalid refs", () => {
    assert.equal(
      validateStaffActionsContext({ ...validContext, customerId: "x" }),
      null,
    );
    assert.equal(
      validateStaffActionsContext({
        ...validContext,
        customers: [{ ...validContext.customers[0], ref: "BAD" }],
      }),
      null,
    );
    assert.equal(validateStaffActionsContext(null), null);
  });

  it("parses valid staff request bodies", () => {
    const parsed = parseCrmAiRequestBody({
      task: "staff_today_actions",
      schemaVersion: STAFF_TODAY_ACTIONS_PROMPT_VERSION,
      locale: "zh-Hans",
      context: validContext,
    });
    assert.equal(parsed?.task, "staff_today_actions");
    assert.equal(parsed && "context" in parsed && Array.isArray(parsed.context.customers), true);
  });
});

describe("staff_today_actions output validation", () => {
  it("accepts structured staff output with known refs", () => {
    const allowed = new Set(["C1", "C2"]);
    assert.equal(validateStaffActionsOutput(validOutput, allowed), true);
  });

  it("rejects unknown customerRef C99", () => {
    const allowed = new Set(["C1", "C2"]);
    assert.equal(
      validateStaffActionsOutput(
        {
          headline: "x",
          actions: [
            {
              customerRef: "C99",
              category: "overdue",
              title: "bad",
              reason: "bad",
              urgency: "urgent",
            },
          ],
        },
        allowed,
      ),
      false,
    );
  });

  it("rejects unsafe markup and external URLs", () => {
    const allowed = new Set(["C1"]);
    assert.equal(
      validateStaffActionsOutput(
        {
          headline: "<script>bad</script>",
          actions: [],
        },
        allowed,
      ),
      false,
    );
  });
});

describe("staff_today_actions service", () => {
  it("returns structured success from Workers AI wrapper", async () => {
    const env = makeEnv(async () => ({ response: validOutput }));
    const result = await handleCrmAiRequest(env, {
      task: "staff_today_actions",
      schemaVersion: STAFF_TODAY_ACTIONS_PROMPT_VERSION,
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

    const result = await runStaffTodayActions(env, {
      task: "staff_today_actions",
      schemaVersion: STAFF_TODAY_ACTIONS_PROMPT_VERSION,
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
    const result = await runStaffTodayActions(env, {
      task: "staff_today_actions",
      schemaVersion: STAFF_TODAY_ACTIONS_PROMPT_VERSION,
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

describe("admin task regression", () => {
  it("still handles admin_management_brief requests", async () => {
    const adminContext = {
      metrics: {
        newCustomersToday: 0,
        validFollowUpsToday: 0,
        pendingApprovals: 0,
        autoReleaseWithin7Days: 0,
        autoReleaseTomorrow: 0,
        overdueFollowUps: 0,
        publicPoolEnteredToday: 0,
        totalCustomers: 0,
      },
      teamAggregates: {
        activeStaffCount: 0,
        staffWithOverdueCount: 0,
        staffWithReclamationRiskCount: 0,
        teamPendingItemsTotal: 0,
        teamCurrentCustomersTotal: 0,
      },
      reclamationRisk: {
        tomorrowCount: 0,
        within7Count: 0,
        membersAtRiskCount: 0,
        pendingRiskCount: 0,
      },
      stageDistribution: [],
      trendSummary: {
        validFollowUpsLast7Days: 0,
        newCustomersLast7Days: 0,
        stageProgressLast7Days: 0,
      },
    };
    const env = makeEnv(async () => ({
      response: {
        headline: "管理摘要",
        summary: "稳定。",
        priorities: [],
        cautions: ["基于系统数据。"],
      },
    }));
    const result = await handleCrmAiRequest(env, {
      task: "admin_management_brief",
      schemaVersion: "10b-v1",
      locale: "zh-Hans",
      context: adminContext,
    });
    assert.equal(result.ok, true);
  });
});
