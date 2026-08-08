import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { generateAdminManagementBriefInsight } from "./admin-insight";
import { clearDashboardAiCacheForTests } from "./cache";
import type { AdminAiProviderContext } from "./context/admin-context";
import type { CloudflareAdminCallResult } from "./cloudflare-admin";

const admin = {
  id: "11111111-1111-1111-1111-111111111101",
  role: "admin",
} as const;

const adminContext: AdminAiProviderContext = {
  metrics: {
    newCustomersToday: 1,
    validFollowUpsToday: 2,
    pendingApprovals: 2,
    autoReleaseWithin7Days: 1,
    autoReleaseTomorrow: 0,
    overdueFollowUps: 1,
    publicPoolEnteredToday: 0,
    totalCustomers: 12,
  },
  teamAggregates: {
    activeStaffCount: 2,
    staffWithOverdueCount: 1,
    staffWithReclamationRiskCount: 0,
    teamPendingItemsTotal: 1,
    teamCurrentCustomersTotal: 12,
  },
  reclamationRisk: {
    tomorrowCount: 0,
    within7Count: 1,
    membersAtRiskCount: 0,
    pendingRiskCount: 0,
  },
  stageDistribution: [{ stageKey: "negotiation", count: 4, percentage: 33 }],
  trendSummary: {
    validFollowUpsLast7Days: 8,
    newCustomersLast7Days: 2,
    stageProgressLast7Days: 1,
  },
};

const providerBrief = {
  headline: "今日管理重点",
  summary: "请优先处理审批与跟进。",
  priorities: [
    {
      category: "approvals",
      title: "处理待审批",
      reason: "当前有 2 项待审批。",
      urgency: "attention",
    },
  ],
  cautions: ["本摘要基于系统数据。"],
};

function mockDb() {
  return {} as never;
}

async function mockBuildContext() {
  return { providerContext: adminContext };
}

describe("admin cloudflare dashboard insight", () => {
  it("uses Cloudflare path and returns provider source", async () => {
    clearDashboardAiCacheForTests();
    let cloudflareCalls = 0;
    const result = await generateAdminManagementBriefInsight(
      {
        viewer: admin as never,
        insightType: "admin_management_brief",
        locale: "zh-Hans",
      },
      mockDb(),
      {
        buildContext: mockBuildContext,
        callCloudflare: async () => {
          cloudflareCalls += 1;
          return { ok: true, raw: providerBrief, model: "@cf/qwen/qwen3-30b-a3b-fp8" };
        },
      },
    );

    assert.equal(cloudflareCalls, 1);
    assert.equal(result.status, "success");
    assert.equal(result.source, "provider");
    assert.equal(result.payload?.insightType, "admin_management_brief");
  });

  it("does not require legacy ai_enabled for admin", async () => {
    clearDashboardAiCacheForTests();
    const result = await generateAdminManagementBriefInsight(
      {
        viewer: admin as never,
        insightType: "admin_management_brief",
        locale: "zh-Hans",
      },
      mockDb(),
      {
        buildContext: mockBuildContext,
        callCloudflare: async () => ({
          ok: true,
          raw: providerBrief,
          model: "@cf/qwen/qwen3-30b-a3b-fp8",
        }),
      },
    );

    assert.equal(result.status, "success");
    assert.equal(result.source, "provider");
  });

  it("falls back to system_fallback when Cloudflare fails", async () => {
    clearDashboardAiCacheForTests();
    const result = await generateAdminManagementBriefInsight(
      {
        viewer: admin as never,
        insightType: "admin_management_brief",
        locale: "zh-Hans",
      },
      mockDb(),
      {
        buildContext: mockBuildContext,
        callCloudflare: async () => ({ ok: false, category: "timeout" }),
      },
    );

    assert.equal(result.status, "success");
    assert.equal(result.source, "system_fallback");
    assert.equal(result.payload?.insightType, "admin_management_brief");
  });
});

describe("staff legacy dashboard insight routing", () => {
  it("keeps staff on legacy provider path in service source", () => {
    const source = readFileSync(
      "src/lib/ai/dashboard-insights/service.ts",
      "utf8",
    );
    assert.match(source, /input\.insightType === "admin_management_brief"/);
    assert.match(source, /generateAdminManagementBriefInsight/);
    assert.match(source, /callDashboardAiProvider/);
    assert.match(source, /if \(!aiSettings\.aiEnabled\)/);
  });
});

describe("admin cloudflare client mapping", () => {
  it("maps crm-ai errors to system fallback without Gemini fallback", async () => {
    const cases: CloudflareAdminCallResult[] = [
      { ok: false, category: "timeout" },
      { ok: false, category: "invalid_response" },
      { ok: false, category: "unavailable" },
    ];

    for (const providerResult of cases) {
      clearDashboardAiCacheForTests();
      const result = await generateAdminManagementBriefInsight(
        {
          viewer: admin as never,
          insightType: "admin_management_brief",
          locale: "zh-Hans",
        },
        mockDb(),
        {
          buildContext: mockBuildContext,
          callCloudflare: async () => providerResult,
        },
      );
      assert.equal(result.source, "system_fallback");
      assert.equal(result.status, "success");
    }
  });
});
