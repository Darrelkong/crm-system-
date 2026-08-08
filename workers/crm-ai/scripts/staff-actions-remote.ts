/**
 * Remote staff_today_actions probe (synthetic aggregate context only).
 */
import { getPlatformProxy } from "wrangler";
import { handleCrmAiRequest } from "../src/service";
import { STAFF_TODAY_ACTIONS_PROMPT_VERSION } from "../src/staff-actions";
import type { CrmAiEnv } from "../src/types";

const sampleContext = {
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
    validFollowUpsLast7Days: 6,
    newCustomersLast7Days: 1,
  },
  customers: [
    {
      ref: "C1",
      stage: "negotiation",
      followUpStatus: "overdue",
      overdueHours: 10,
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

async function main() {
  const proxy = await getPlatformProxy<{ AI: Ai }>({
    configPath: "workers/crm-ai/wrangler.jsonc",
    remoteBindings: true,
  });

  const env: CrmAiEnv = { AI: proxy.env.AI, CRM_AI_TIMEOUT_MS: "20000" };
  const startedAt = Date.now();
  const result = await handleCrmAiRequest(env, {
    task: "staff_today_actions",
    schemaVersion: STAFF_TODAY_ACTIONS_PROMPT_VERSION,
    locale: "zh-Hans",
    context: sampleContext,
  });

  const refs =
    result.ok && Array.isArray(result.data.actions)
      ? result.data.actions
          .map((action) => action.customerRef)
          .filter((ref): ref is string => typeof ref === "string")
      : [];

  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        model: result.ok ? result.model : undefined,
        error: result.ok ? undefined : result.error,
        durationMs: Date.now() - startedAt,
        actionCount: result.ok ? result.data.actions.length : 0,
        customerRefs: refs,
        onlyKnownRefs: refs.every((ref) => ref === "C1" || ref === "C2"),
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
      error: error instanceof Error ? error.message : "staff_actions_probe_failed",
    }),
  );
  process.exit(1);
});
