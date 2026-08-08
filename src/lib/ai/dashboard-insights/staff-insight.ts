import type { Database } from "@/lib/db";
import { buildDashboardAiContext } from "./context";
import {
  buildDashboardAiCacheKey,
  getDashboardAiCache,
  setDashboardAiCache,
} from "./cache";
import {
  completeDashboardAiProviderRefresh,
  reserveDashboardAiProviderRefresh,
} from "./rate-limit";
import { buildDashboardAiContextFingerprint } from "./fingerprint";
import { getDashboardAiSafeMessage } from "./messages";
import { validateDashboardAiProviderOutput } from "./validate-output";
import { logDashboardAiAudit } from "./logging";
import { buildDeterministicStaffActions } from "./fallback";
import {
  callStaffCloudflareAi,
  CLOUDFLARE_STAFF_AI_MODEL,
  type CloudflareStaffCallResult,
} from "./cloudflare-staff";
import type {
  DashboardAiInsightResult,
  GenerateDashboardAiInsightInput,
} from "./types";
import type { StaffAiProviderContext } from "./context/staff-context";
import type { StaffCustomerRefMap } from "./customer-ref";

export type StaffInsightDeps = {
  aiService?: CloudflareEnv["AI_SERVICE"];
  callCloudflare?: typeof callStaffCloudflareAi;
  buildContext?: typeof buildDashboardAiContext;
};

function buildStatusResult(
  status: Exclude<DashboardAiInsightResult["status"], "success" | undefined>,
  locale: GenerateDashboardAiInsightInput["locale"],
): DashboardAiInsightResult {
  return {
    status,
    message: getDashboardAiSafeMessage(status, locale),
  };
}

function buildStaffSystemFallbackResult(
  context: StaffAiProviderContext,
  refMap: StaffCustomerRefMap,
  fingerprint: string,
  now: Date,
  cacheKey: string,
): DashboardAiInsightResult {
  const fallbackInsight = buildDeterministicStaffActions(context);
  const validated = validateDashboardAiProviderOutput(
    "staff_today_actions",
    fallbackInsight,
    refMap,
  );
  const payload =
    validated.ok
      ? validated.payload
      : {
          insightType: "staff_today_actions" as const,
          insight: fallbackInsight,
        };

  const result: DashboardAiInsightResult = {
    status: "success",
    source: "system_fallback",
    fingerprint,
    payload,
  };
  setDashboardAiCache(cacheKey, result, now.getTime());
  return result;
}

function shouldUseSystemFallback(
  providerResult: Extract<CloudflareStaffCallResult, { ok: false }>,
): boolean {
  return providerResult.category !== "rate_limited";
}

export async function generateStaffTodayActionsInsight(
  input: GenerateDashboardAiInsightInput,
  db: Database,
  deps: StaffInsightDeps = {},
): Promise<DashboardAiInsightResult> {
  const now = input.now ?? new Date();
  const locale = input.locale;
  const callCloudflare = deps.callCloudflare ?? callStaffCloudflareAi;
  const buildContext = deps.buildContext ?? buildDashboardAiContext;

  const contextBundle = await buildContext(
    db,
    input.viewer,
    "staff_today_actions",
    now,
  );
  const staffContext = contextBundle.providerContext as StaffAiProviderContext;
  const refMap = contextBundle.refMap!;
  const fingerprint = buildDashboardAiContextFingerprint({
    viewerRole: input.viewer.role,
    viewerId: input.viewer.id,
    insightType: "staff_today_actions",
    locale,
    context: staffContext,
  });

  const cacheKey = buildDashboardAiCacheKey({
    viewerId: input.viewer.id,
    viewerRole: input.viewer.role,
    insightType: "staff_today_actions",
    locale,
    fingerprint,
  });

  if (!input.forceRefresh) {
    const cached = getDashboardAiCache(cacheKey, now.getTime());
    if (cached) {
      logDashboardAiAudit({
        at: now.toISOString(),
        viewerId: input.viewer.id,
        role: input.viewer.role,
        insightType: "staff_today_actions",
        status: cached.status,
        cacheHit: true,
        fingerprint,
      });
      return cached;
    }
  }

  let rateLimitEventId: string | null = null;
  if (input.forceRefresh) {
    const rate = await reserveDashboardAiProviderRefresh(db, {
      userId: input.viewer.id,
      insightType: "staff_today_actions",
      now,
    });
    if (!rate.allowed) {
      return buildStatusResult("rate_limited", locale);
    }
    rateLimitEventId = rate.eventId;
  }

  const startedAt = Date.now();
  let rateLimitOutcome: "succeeded" | "failed" = "failed";

  try {
    const providerResult = await callCloudflare(
      staffContext,
      locale,
      deps.aiService,
    );

    if (!providerResult.ok) {
      if (providerResult.category === "rate_limited") {
        return buildStatusResult("rate_limited", locale);
      }

      logDashboardAiAudit({
        at: now.toISOString(),
        viewerId: input.viewer.id,
        role: input.viewer.role,
        insightType: "staff_today_actions",
        provider: "cloudflare_workers_ai",
        model: CLOUDFLARE_STAFF_AI_MODEL,
        durationMs: Date.now() - startedAt,
        status: shouldUseSystemFallback(providerResult)
          ? "system_fallback"
          : providerResult.category,
        fingerprint,
      });

      if (shouldUseSystemFallback(providerResult)) {
        rateLimitOutcome = "succeeded";
        return buildStaffSystemFallbackResult(
          staffContext,
          refMap,
          fingerprint,
          now,
          cacheKey,
        );
      }

      return buildStatusResult("unavailable", locale);
    }

    const validated = validateDashboardAiProviderOutput(
      "staff_today_actions",
      providerResult.raw,
      refMap,
    );
    if (!validated.ok) {
      logDashboardAiAudit({
        at: now.toISOString(),
        viewerId: input.viewer.id,
        role: input.viewer.role,
        insightType: "staff_today_actions",
        provider: "cloudflare_workers_ai",
        model: providerResult.model,
        durationMs: Date.now() - startedAt,
        status: "system_fallback",
        fingerprint,
      });
      rateLimitOutcome = "succeeded";
      return buildStaffSystemFallbackResult(
        staffContext,
        refMap,
        fingerprint,
        now,
        cacheKey,
      );
    }

    const result: DashboardAiInsightResult = {
      status: "success",
      source: "provider",
      fingerprint,
      payload: validated.payload,
    };
    setDashboardAiCache(cacheKey, result, now.getTime());
    logDashboardAiAudit({
      at: now.toISOString(),
      viewerId: input.viewer.id,
      role: input.viewer.role,
      insightType: "staff_today_actions",
      provider: "cloudflare_workers_ai",
      model: providerResult.model,
      durationMs: Date.now() - startedAt,
      status: "success",
      fingerprint,
    });
    rateLimitOutcome = "succeeded";
    return result;
  } finally {
    if (rateLimitEventId) {
      await completeDashboardAiProviderRefresh(
        db,
        rateLimitEventId,
        rateLimitOutcome,
        now,
      );
    }
  }
}
