import type { Database } from "@/lib/db";
import { getDb } from "@/lib/db";
import { getAiApiKeyFromEnv } from "@/lib/ai/env";
import { getEffectiveAiSettings } from "@/lib/settings/ai-effective";
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
import { DashboardAiPermissionError } from "./errors";
import { getDashboardAiSafeMessage } from "./messages";
import {
  callDashboardAiProvider,
  resolveDashboardAiProviderConfig,
} from "./provider";
import { generateMockDashboardAiOutput } from "./mock";
import {
  allowMockDashboardInsightGeneration,
  isProductionRuntime,
  MOCK_DASHBOARD_INSIGHT_MODEL,
} from "./mock-constants";
import { validateDashboardAiProviderOutput } from "./validate-output";
import { logDashboardAiAudit } from "./logging";
import {
  buildDeterministicAdminBrief,
  buildDeterministicStaffActions,
} from "./fallback";
import type { AdminAiProviderContext } from "./context/admin-context";
import type { StaffAiProviderContext } from "./context/staff-context";
import type {
  DashboardAiInsightResult,
  GenerateDashboardAiInsightInput,
} from "./types";

function assertInsightTypeAllowedForViewer(
  input: GenerateDashboardAiInsightInput,
): void {
  if (
    input.insightType === "admin_management_brief" &&
    input.viewer.role !== "admin"
  ) {
    throw new DashboardAiPermissionError();
  }
  if (
    input.insightType === "staff_today_actions" &&
    input.viewer.role !== "staff"
  ) {
    throw new DashboardAiPermissionError();
  }
}

function buildDisabledResult(
  locale: GenerateDashboardAiInsightInput["locale"],
): DashboardAiInsightResult {
  return {
    status: "disabled",
    message: getDashboardAiSafeMessage("disabled", locale),
  };
}

function buildStatusResult(
  status: Exclude<DashboardAiInsightResult["status"], "success" | undefined>,
  locale: GenerateDashboardAiInsightInput["locale"],
): DashboardAiInsightResult {
  return {
    status,
    message: getDashboardAiSafeMessage(status, locale),
  };
}

function buildSystemFallbackPayload(
  insightType: GenerateDashboardAiInsightInput["insightType"],
  providerContext: unknown,
) {
  if (insightType === "admin_management_brief") {
    return {
      insightType,
      insight: buildDeterministicAdminBrief(
        providerContext as AdminAiProviderContext,
      ),
    };
  }
  return {
    insightType,
    insight: buildDeterministicStaffActions(
      providerContext as StaffAiProviderContext,
    ),
  };
}

function willConsumeProviderOrMock(
  providerKind: ReturnType<typeof resolveDashboardAiProviderConfig>["providerKind"],
): boolean {
  if (providerKind !== "mock") {
    return true;
  }
  return !isProductionRuntime() && allowMockDashboardInsightGeneration();
}

export async function generateDashboardAiInsight(
  input: GenerateDashboardAiInsightInput,
  db: Database = getDb(),
): Promise<DashboardAiInsightResult> {
  const now = input.now ?? new Date();
  const locale = input.locale;
  assertInsightTypeAllowedForViewer(input);

  const aiSettings = await getEffectiveAiSettings(db);
  if (!aiSettings.aiEnabled) {
    return buildDisabledResult(locale);
  }

  const contextBundle = await buildDashboardAiContext(
    db,
    input.viewer,
    input.insightType,
    now,
  );
  const fingerprint = buildDashboardAiContextFingerprint({
    viewerRole: input.viewer.role,
    viewerId: input.viewer.id,
    insightType: input.insightType,
    locale,
    context: contextBundle.providerContext,
  });

  const cacheKey = buildDashboardAiCacheKey({
    viewerId: input.viewer.id,
    viewerRole: input.viewer.role,
    insightType: input.insightType,
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
        insightType: input.insightType,
        status: cached.status,
        cacheHit: true,
        fingerprint,
      });
      return cached;
    }
  }

  const providerConfig = resolveDashboardAiProviderConfig(
    aiSettings,
    getAiApiKeyFromEnv(),
  );

  let rateLimitEventId: string | null = null;
  if (
    input.forceRefresh &&
    willConsumeProviderOrMock(providerConfig.providerKind)
  ) {
    const rate = await reserveDashboardAiProviderRefresh(db, {
      userId: input.viewer.id,
      insightType: input.insightType,
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
    if (providerConfig.providerKind === "mock") {
      if (isProductionRuntime()) {
        const fallback = buildSystemFallbackPayload(
          input.insightType,
          contextBundle.providerContext,
        );
        const result: DashboardAiInsightResult = {
          status: "success",
          source: "system_fallback",
          fingerprint,
          payload: fallback,
        };
        setDashboardAiCache(cacheKey, result, now.getTime());
        rateLimitOutcome = "succeeded";
        return result;
      }
      if (!allowMockDashboardInsightGeneration()) {
        return buildStatusResult("unavailable", locale);
      }
      const raw = generateMockDashboardAiOutput(
        input.insightType,
        contextBundle.providerContext,
      );
      const validated = validateDashboardAiProviderOutput(
        input.insightType,
        raw,
        contextBundle.refMap,
      );
      if (!validated.ok) {
        return buildStatusResult("invalid_response", locale);
      }
      const result: DashboardAiInsightResult = {
        status: "success",
        source: "mock",
        fingerprint,
        payload: validated.payload,
      };
      setDashboardAiCache(cacheKey, result, now.getTime());
      logDashboardAiAudit({
        at: now.toISOString(),
        viewerId: input.viewer.id,
        role: input.viewer.role,
        insightType: input.insightType,
        provider: "mock",
        model: MOCK_DASHBOARD_INSIGHT_MODEL,
        durationMs: Date.now() - startedAt,
        status: "success",
        fingerprint,
      });
      rateLimitOutcome = "succeeded";
      return result;
    }

    const providerResult = await callDashboardAiProvider(
      providerConfig,
      aiSettings,
      input.insightType,
      contextBundle.providerContext,
    );

    if (!providerResult.ok) {
      const status =
        providerResult.category === "timeout"
          ? "timeout"
          : providerResult.category === "rate_limited"
            ? "rate_limited"
            : providerResult.category === "invalid_response"
              ? "invalid_response"
              : "unavailable";

      logDashboardAiAudit({
        at: now.toISOString(),
        viewerId: input.viewer.id,
        role: input.viewer.role,
        insightType: input.insightType,
        provider: providerConfig.providerKind,
        model: providerConfig.model,
        durationMs: Date.now() - startedAt,
        status,
        fingerprint,
      });

      return buildStatusResult(status, locale);
    }

    const validated = validateDashboardAiProviderOutput(
      input.insightType,
      providerResult.raw,
      contextBundle.refMap,
    );
    if (!validated.ok) {
      logDashboardAiAudit({
        at: now.toISOString(),
        viewerId: input.viewer.id,
        role: input.viewer.role,
        insightType: input.insightType,
        provider: providerConfig.providerKind,
        model: providerConfig.model,
        durationMs: Date.now() - startedAt,
        status: "invalid_response",
        fingerprint,
      });
      return buildStatusResult("invalid_response", locale);
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
      insightType: input.insightType,
      provider: providerConfig.providerKind,
      model: providerConfig.model,
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
