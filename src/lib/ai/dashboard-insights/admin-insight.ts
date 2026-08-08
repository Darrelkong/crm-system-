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
import { buildDeterministicAdminBrief } from "./fallback";
import {
  callAdminCloudflareAi,
  CLOUDFLARE_ADMIN_AI_MODEL,
  type CloudflareAdminCallResult,
} from "./cloudflare-admin";
import type {
  DashboardAiInsightResult,
  GenerateDashboardAiInsightInput,
} from "./types";
import type { AdminAiProviderContext } from "./context/admin-context";

export type AdminInsightDeps = {
  aiService?: CloudflareEnv["AI_SERVICE"];
  callCloudflare?: typeof callAdminCloudflareAi;
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

function buildAdminSystemFallbackResult(
  context: AdminAiProviderContext,
  fingerprint: string,
  now: Date,
  cacheKey: string,
): DashboardAiInsightResult {
  const result: DashboardAiInsightResult = {
    status: "success",
    source: "system_fallback",
    fingerprint,
    payload: {
      insightType: "admin_management_brief",
      insight: buildDeterministicAdminBrief(context),
    },
  };
  setDashboardAiCache(cacheKey, result, now.getTime());
  return result;
}

function shouldUseSystemFallback(
  providerResult: Extract<CloudflareAdminCallResult, { ok: false }>,
): boolean {
  return providerResult.category !== "rate_limited";
}

export async function generateAdminManagementBriefInsight(
  input: GenerateDashboardAiInsightInput,
  db: Database,
  deps: AdminInsightDeps = {},
): Promise<DashboardAiInsightResult> {
  const now = input.now ?? new Date();
  const locale = input.locale;
  const callCloudflare = deps.callCloudflare ?? callAdminCloudflareAi;
  const buildContext = deps.buildContext ?? buildDashboardAiContext;

  const contextBundle = await buildContext(
    db,
    input.viewer,
    "admin_management_brief",
    now,
  );
  const adminContext = contextBundle.providerContext as AdminAiProviderContext;
  const fingerprint = buildDashboardAiContextFingerprint({
    viewerRole: input.viewer.role,
    viewerId: input.viewer.id,
    insightType: "admin_management_brief",
    locale,
    context: adminContext,
  });

  const cacheKey = buildDashboardAiCacheKey({
    viewerId: input.viewer.id,
    viewerRole: input.viewer.role,
    insightType: "admin_management_brief",
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
        insightType: "admin_management_brief",
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
      insightType: "admin_management_brief",
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
      adminContext,
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
        insightType: "admin_management_brief",
        provider: "cloudflare_workers_ai",
        model: CLOUDFLARE_ADMIN_AI_MODEL,
        durationMs: Date.now() - startedAt,
        status: shouldUseSystemFallback(providerResult)
          ? "system_fallback"
          : providerResult.category,
        fingerprint,
      });

      if (shouldUseSystemFallback(providerResult)) {
        rateLimitOutcome = "succeeded";
        return buildAdminSystemFallbackResult(
          adminContext,
          fingerprint,
          now,
          cacheKey,
        );
      }

      return buildStatusResult("unavailable", locale);
    }

    const validated = validateDashboardAiProviderOutput(
      "admin_management_brief",
      providerResult.raw,
    );
    if (!validated.ok) {
      logDashboardAiAudit({
        at: now.toISOString(),
        viewerId: input.viewer.id,
        role: input.viewer.role,
        insightType: "admin_management_brief",
        provider: "cloudflare_workers_ai",
        model: providerResult.model,
        durationMs: Date.now() - startedAt,
        status: "system_fallback",
        fingerprint,
      });
      rateLimitOutcome = "succeeded";
      return buildAdminSystemFallbackResult(
        adminContext,
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
      insightType: "admin_management_brief",
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
