/**
 * Remote admin_management_brief probe (synthetic aggregate context only).
 */
import { getPlatformProxy } from "wrangler";
import { handleCrmAiRequest } from "../src/service";
import { ADMIN_MANAGEMENT_BRIEF_PROMPT_VERSION } from "../src/admin-brief";
import type { CrmAiEnv } from "../src/types";

const sampleContext = {
  metrics: {
    newCustomersToday: 2,
    validFollowUpsToday: 5,
    pendingApprovals: 1,
    autoReleaseWithin7Days: 2,
    autoReleaseTomorrow: 0,
    overdueFollowUps: 1,
    publicPoolEnteredToday: 0,
    totalCustomers: 20,
  },
  teamAggregates: {
    activeStaffCount: 3,
    staffWithOverdueCount: 1,
    staffWithReclamationRiskCount: 1,
    teamPendingItemsTotal: 2,
    teamCurrentCustomersTotal: 20,
  },
  reclamationRisk: {
    tomorrowCount: 0,
    within7Count: 2,
    membersAtRiskCount: 1,
    pendingRiskCount: 0,
  },
  stageDistribution: [{ stageKey: "negotiation", count: 6, percentage: 30 }],
  trendSummary: {
    validFollowUpsLast7Days: 12,
    newCustomersLast7Days: 4,
    stageProgressLast7Days: 2,
  },
};

async function main() {
  const proxy = await getPlatformProxy<{ AI: Ai }>({
    configPath: "workers/crm-ai/wrangler.jsonc",
    remoteBindings: true,
  });

  const env: CrmAiEnv = { AI: proxy.env.AI, CRM_AI_TIMEOUT_MS: "20000" };
  const startedAt = Date.now();
  const result = await handleCrmAiRequest(env, {
    task: "admin_management_brief",
    schemaVersion: ADMIN_MANAGEMENT_BRIEF_PROMPT_VERSION,
    locale: "zh-Hans",
    context: sampleContext,
  });

  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        model: result.ok ? result.model : undefined,
        error: result.ok ? undefined : result.error,
        durationMs: Date.now() - startedAt,
        hasHeadline: result.ok ? Boolean(result.data.headline) : false,
        priorityCount: result.ok ? result.data.priorities.length : 0,
      },
      null,
      2,
    ),
  );

  await proxy.dispose();
  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "admin_brief_probe_failed",
    }),
  );
  process.exit(1);
});
