import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { generateStaffTodayActionsInsight } from "./staff-insight";
import { generateAdminManagementBriefInsight } from "./admin-insight";
import { clearDashboardAiCacheForTests } from "./cache";
import { validateDashboardAiProviderOutput } from "./validate-output";
import { StaffCustomerRefMap } from "./customer-ref";
import type { StaffAiProviderContext } from "./context/staff-context";
import type { CloudflareStaffCallResult } from "./cloudflare-staff";

const staffA = {
  id: "11111111-1111-1111-1111-111111111102",
  role: "staff",
} as const;

const staffB = {
  id: "11111111-1111-1111-1111-111111111103",
  role: "staff",
} as const;

const staffAContext: StaffAiProviderContext = {
  metrics: {
    dueTodayFollowUps: 1,
    overdueFollowUps: 1,
    autoReleaseWithin7Days: 1,
    autoReleaseTomorrow: 0,
    pendingWorkItems: 1,
    validFollowUpsToday: 2,
    myCustomerCount: 2,
  },
  reclamationRisk: {
    tomorrowCount: 0,
    within7Count: 1,
    pendingRiskCount: 0,
  },
  stageDistribution: [{ stageKey: "negotiation", count: 1, percentage: 50 }],
  trendSummary: {
    validFollowUpsLast7Days: 5,
    newCustomersLast7Days: 1,
  },
  customers: [
    {
      ref: "C1",
      stage: "negotiation",
      followUpStatus: "overdue",
      overdueHours: 8,
      pendingActions: ["follow_up"],
    },
  ],
};

const staffBContext: StaffAiProviderContext = {
  ...staffAContext,
  metrics: { ...staffAContext.metrics, myCustomerCount: 3 },
  customers: [
    {
      ref: "C1",
      stage: "contacted",
      followUpStatus: "due_today",
      pendingActions: ["follow_up"],
    },
    {
      ref: "C2",
      stage: "negotiation",
      followUpStatus: "scheduled",
      reclamationDaysRemaining: 4,
      pendingActions: ["reclamation"],
    },
  ],
};

const providerActions = {
  headline: "今日建议",
  actions: [
    {
      customerRef: "C1",
      category: "overdue",
      title: "跟进 C1",
      reason: "客户已逾期。",
      urgency: "urgent",
    },
  ],
};

function mockDb() {
  return {} as never;
}

async function mockStaffAContext() {
  return {
    providerContext: staffAContext,
    refMap: new StaffCustomerRefMap(["cust-a-1"]),
  };
}

async function mockStaffBContext() {
  return {
    providerContext: staffBContext,
    refMap: new StaffCustomerRefMap(["cust-b-1", "cust-b-2"]),
  };
}

describe("staff cloudflare dashboard insight", () => {
  it("uses Cloudflare path and returns provider source", async () => {
    clearDashboardAiCacheForTests();
    let cloudflareCalls = 0;
    const result = await generateStaffTodayActionsInsight(
      {
        viewer: staffA as never,
        insightType: "staff_today_actions",
        locale: "zh-Hans",
      },
      mockDb(),
      {
        buildContext: mockStaffAContext,
        callCloudflare: async () => {
          cloudflareCalls += 1;
          return { ok: true, raw: providerActions, model: "@cf/qwen/qwen3-30b-a3b-fp8" };
        },
      },
    );

    assert.equal(cloudflareCalls, 1);
    assert.equal(result.status, "success");
    assert.equal(result.source, "provider");
    assert.equal(result.payload?.insightType, "staff_today_actions");
  });

  it("falls back to system_fallback when Cloudflare fails", async () => {
    clearDashboardAiCacheForTests();
    const result = await generateStaffTodayActionsInsight(
      {
        viewer: staffA as never,
        insightType: "staff_today_actions",
        locale: "zh-Hans",
      },
      mockDb(),
      {
        buildContext: mockStaffAContext,
        callCloudflare: async () => ({ ok: false, category: "timeout" }),
      },
    );

    assert.equal(result.status, "success");
    assert.equal(result.source, "system_fallback");
  });

  it("isolates Staff A and Staff B contexts", async () => {
    clearDashboardAiCacheForTests();
    const seen: string[] = [];

    await generateStaffTodayActionsInsight(
      {
        viewer: staffA as never,
        insightType: "staff_today_actions",
        locale: "zh-Hans",
      },
      mockDb(),
      {
        buildContext: mockStaffAContext,
        callCloudflare: async (context) => {
          seen.push(context.customers.map((c) => c.ref).join(","));
          return { ok: true, raw: providerActions, model: "@cf/qwen/qwen3-30b-a3b-fp8" };
        },
      },
    );

    await generateStaffTodayActionsInsight(
      {
        viewer: staffB as never,
        insightType: "staff_today_actions",
        locale: "zh-Hans",
      },
      mockDb(),
      {
        buildContext: mockStaffBContext,
        callCloudflare: async (context) => {
          seen.push(context.customers.map((c) => c.ref).join(","));
          return {
            ok: true,
            raw: {
              headline: "B",
              actions: [
                {
                  customerRef: "C2",
                  category: "reclamation",
                  title: "关注 C2",
                  reason: "释放风险。",
                  urgency: "attention",
                },
              ],
            },
            model: "@cf/qwen/qwen3-30b-a3b-fp8",
          };
        },
      },
    );

    assert.deepEqual(seen, ["C1", "C1,C2"]);
  });
});

describe("staff refMap validation", () => {
  it("filters unauthorized customerRef in main validator", () => {
    const refMap = new StaffCustomerRefMap(["cust-a-1"]);
    const validated = validateDashboardAiProviderOutput(
      "staff_today_actions",
      {
        headline: "今日",
        actions: [
          {
            customerRef: "C1",
            category: "overdue",
            title: "ok",
            reason: "ok",
            urgency: "urgent",
          },
          {
            customerRef: "C99",
            category: "overdue",
            title: "bad",
            reason: "bad",
            urgency: "urgent",
          },
        ],
      },
      refMap,
    );
    assert.equal(validated.ok, true);
    if (!validated.ok) throw new Error("expected success");
    if (validated.payload.insightType !== "staff_today_actions") {
      throw new Error("expected staff payload");
    }
    assert.equal(validated.payload.insight.actions.length, 1);
    assert.equal(validated.payload.insight.actions[0]?.customerRef, "C1");
  });
});

describe("dashboard cloudflare routing", () => {
  it("routes both admin and staff through dedicated cloudflare modules", () => {
    const source = readFileSync(
      "src/lib/ai/dashboard-insights/service.ts",
      "utf8",
    );
    assert.match(source, /generateAdminManagementBriefInsight/);
    assert.match(source, /generateStaffTodayActionsInsight/);
    assert.doesNotMatch(source, /callDashboardAiProvider/);
    assert.doesNotMatch(source, /getEffectiveAiSettings/);
    assert.doesNotMatch(source, /aiEnabled/);
  });
});

describe("admin cloudflare regression", () => {
  it("admin path remains available after staff migration", async () => {
    clearDashboardAiCacheForTests();
    const result = await generateAdminManagementBriefInsight(
      {
        viewer: { id: "admin-1", role: "admin" } as never,
        insightType: "admin_management_brief",
        locale: "zh-Hans",
      },
      mockDb(),
      {
        buildContext: async () => ({
          providerContext: {
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
          },
        }),
        callCloudflare: async () => ({
          ok: true,
          raw: {
            headline: "管理",
            summary: "稳定",
            priorities: [],
            cautions: ["基于系统数据。"],
          },
          model: "@cf/qwen/qwen3-30b-a3b-fp8",
        }),
      },
    );
    assert.equal(result.status, "success");
    assert.equal(result.source, "provider");
  });
});

describe("staff cloudflare client mapping", () => {
  it("maps crm-ai errors to system fallback without Gemini fallback", async () => {
    const cases: CloudflareStaffCallResult[] = [
      { ok: false, category: "timeout" },
      { ok: false, category: "invalid_response" },
      { ok: false, category: "unavailable" },
    ];

    for (const providerResult of cases) {
      clearDashboardAiCacheForTests();
      const result = await generateStaffTodayActionsInsight(
        {
          viewer: staffA as never,
          insightType: "staff_today_actions",
          locale: "zh-Hans",
        },
        mockDb(),
        {
          buildContext: mockStaffAContext,
          callCloudflare: async () => providerResult,
        },
      );
      assert.equal(result.source, "system_fallback");
      assert.equal(result.status, "success");
    }
  });
});
