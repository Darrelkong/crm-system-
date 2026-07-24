import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  allowMockDeepInsightGeneration,
  getCustomerInsightProviderImpl,
  resolveCustomerInsightProvider,
} from "@/lib/ai/providers/factory";
import { isAiApiKeyConfigured } from "@/lib/ai/env";
import { buildCustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { mapAiAnalysisErrorCode } from "@/lib/ai/customer-insights/error-mapping";
import { isAiRefreshOnCooldown } from "@/lib/ai/customer-insights/cooldown";
import {
  AiAnalysisError,
  AiConfigError,
  AiDeepAnalysisGlobalDisabledError,
  AiDeepAnalysisMockOnlyError,
  AiProviderError,
  AiRefreshCooldownError,
  AiRefreshDeniedError,
  AiStaffDailyLimitReachedError,
  AiStaffDeepAnalysisDisabledError,
  AiStaffReservationConflictError,
} from "@/lib/ai/customer-insights/errors";
import {
  isExternalAiProviderKind,
  reserveStaffAiUsageForRefresh,
  completeStaffAiUsage,
  failStaffAiUsage,
  getStaffAiUsageSummary,
  StaffAiQuotaError,
  type StaffAiReservationResult,
  type StaffAiUsageSummary,
} from "@/lib/ai/staff-usage/service";
import { getBasicCustomerAnalysis } from "@/lib/ai/basic-analysis/service";
import type { BasicCustomerAnalysis } from "@/lib/ai/basic-analysis/types";
import {
  isValidDeepInsight,
  resolveDeepAnalysisAvailability,
  type DeepAnalysisAvailability,
} from "@/lib/ai/deep-analysis/availability";
import { buildResolvedProviderDiagnostics } from "@/lib/ai/customer-insights/diagnostics";
import { computeCustomerInsightSourceHash } from "@/lib/ai/customer-insights/hash";
import { parseCombinedCustomerInsightProviderOutput } from "@/lib/ai/customer-insights/phase2-parse";
import { resolveAiProviderPhase2ContractMode } from "@/lib/ai/customer-insights/provider-contract-mode";
import {
  composePhase2Insight,
  parseStoredPhase2Json,
  sanitizeSuggestedEmployeeMessageForPersist,
  serializePhase2Insight,
  type Phase2FailureCode,
} from "@/lib/ai/customer-insights/phase2-compose";
import type { CustomerInsightOutput } from "@/lib/ai/customer-insights/schema";
import type { Phase2Insight } from "@/lib/ai/phase2/types";
import { getEffectiveSettings } from "@/lib/settings/effective";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import {
  assertCanViewCustomerAiInsight,
  getCustomerAccessLevel,
  resolveCustomerAccessOptions,
  type CustomerAccessOptions,
} from "@/lib/permissions/customers";
import type { CustomerAiInsight } from "../../../../drizzle/schema/customer-ai-insights";
import type { AiProviderKind } from "@/lib/settings/ai-keys";
import { getEffectiveAiSettings, type EffectiveAiSettings } from "@/lib/settings/ai-effective";

export type CustomerAiInsightView = {
  id: string;
  customerId: string;
  intentLevel: string;
  intentScore: number;
  customerSummary: string;
  currentSituation: string;
  keySignals: string[];
  riskFlags: string[];
  missingInformation: string[];
  nextBestAction: string;
  suggestedFollowUpAt: string | null;
  suggestedEmployeeMessage: string;
  confidence: number;
  reasoning: string;
  model: string;
  promptVersion: string;
  sourceHash: string;
  status: string;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Final Phase2Insight when present; null for legacy / degraded rows. */
  phase2: Phase2Insight | null;
};

export type CustomerAiInsightDisplayMeta = {
  showDraftMessage: boolean;
  canRefresh: boolean;
  refreshDisabledReason:
    | "admin_only"
    | "staff_disabled"
    | "staff_deep_analysis_disabled"
    | "daily_limit_reached"
    | "global_disabled"
    | "mock_only"
    | "provider_unavailable"
    | "cooldown"
    | null;
  staffUsage: StaffAiUsageSummary | null;
};

export type CustomerAiInsightBundle = {
  /** @deprecated Prefer basicAnalysis + deepAnalysis; kept for older clients. */
  insight: CustomerAiInsightView | null;
  display: CustomerAiInsightDisplayMeta;
  basicAnalysis: BasicCustomerAnalysis | null;
  deepAnalysis: CustomerAiInsightView | null;
  deepAnalysisAvailability: DeepAnalysisAvailability;
};

const FAILED_PLACEHOLDER: CustomerInsightOutput = {
  intentLevel: "unknown",
  intentScore: 0,
  customerSummary: "AI 分析失败",
  currentSituation: "AI 分析失败，请稍后重试。",
  keySignals: [],
  riskFlags: [],
  missingInformation: [],
  nextBestAction: "请稍后重试手动分析。",
  suggestedFollowUpAt: null,
  suggestedEmployeeMessage: "（暂不可用）",
  confidence: 0,
  reasoning: "AI 分析失败。",
};

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function formatCustomerAiInsight(row: CustomerAiInsight): CustomerAiInsightView {
  return {
    id: row.id,
    customerId: row.customerId,
    intentLevel: row.intentLevel,
    intentScore: row.intentScore,
    customerSummary: row.customerSummary,
    currentSituation: row.currentSituation,
    keySignals: parseJsonArray(row.keySignalsJson),
    riskFlags: parseJsonArray(row.riskFlagsJson),
    missingInformation: parseJsonArray(row.missingInformationJson),
    nextBestAction: row.nextBestAction,
    suggestedFollowUpAt: row.suggestedFollowUpAt,
    suggestedEmployeeMessage: row.suggestedEmployeeMessage,
    confidence: row.confidence,
    reasoning: row.reasoning,
    model: row.model,
    promptVersion: row.promptVersion,
    sourceHash: row.sourceHash,
    status: row.status,
    generatedAt: row.generatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    phase2: parseStoredPhase2Json(row.phase2Json),
  };
}

function refreshReasonFromAvailability(
  reason: DeepAnalysisAvailability["reason"],
): CustomerAiInsightDisplayMeta["refreshDisabledReason"] {
  switch (reason) {
    case "ADMIN_ONLY":
      return "admin_only";
    case "MANUAL_REFRESH_DISABLED":
      return "staff_disabled";
    case "STAFF_DISABLED":
      return "staff_deep_analysis_disabled";
    case "LIMIT_REACHED":
      return "daily_limit_reached";
    case "GLOBAL_DISABLED":
      return "global_disabled";
    case "MOCK_ONLY":
      return "mock_only";
    case "PROVIDER_UNAVAILABLE":
      return "provider_unavailable";
    case "COOLDOWN":
      return "cooldown";
    default:
      return null;
  }
}

export function getCustomerAiInsightDisplayMeta(
  user: User,
  settings: EffectiveAiSettings,
  staffUsage: StaffAiUsageSummary | null = null,
  availability: DeepAnalysisAvailability | null = null,
): CustomerAiInsightDisplayMeta {
  if (availability) {
    return {
      showDraftMessage: settings.aiShowDraftMessage,
      canRefresh: availability.canGenerate,
      refreshDisabledReason: availability.canGenerate
        ? null
        : refreshReasonFromAvailability(availability.reason),
      staffUsage: user.role === "staff" ? staffUsage : null,
    };
  }

  let canRefresh =
    user.role === "admin" ||
    (!settings.aiAdminOnlyManualRefresh && settings.aiStaffManualRefreshEnabled);

  let refreshDisabledReason: CustomerAiInsightDisplayMeta["refreshDisabledReason"] =
    null;

  if (!settings.aiEnabled) {
    canRefresh = false;
    refreshDisabledReason = "global_disabled";
  } else if (settings.aiProvider === "mock") {
    canRefresh = false;
    refreshDisabledReason = "mock_only";
  } else if (!canRefresh) {
    refreshDisabledReason = settings.aiAdminOnlyManualRefresh
      ? "admin_only"
      : "staff_disabled";
  } else if (user.role === "staff") {
    if (!settings.aiStaffDeepAnalysisEnabled) {
      canRefresh = false;
      refreshDisabledReason = "staff_deep_analysis_disabled";
    } else if (staffUsage && staffUsage.remaining <= 0) {
      canRefresh = false;
      refreshDisabledReason = "daily_limit_reached";
    }
  }

  return {
    showDraftMessage: settings.aiShowDraftMessage,
    canRefresh,
    refreshDisabledReason,
    staffUsage: user.role === "staff" ? staffUsage : null,
  };
}

export function assertCanRefreshCustomerAiInsight(
  user: User,
  settings: EffectiveAiSettings,
): void {
  if (user.role === "admin") {
    return;
  }
  if (settings.aiAdminOnlyManualRefresh || !settings.aiStaffManualRefreshEnabled) {
    throw new AiRefreshDeniedError();
  }
}

export async function getCustomerAiInsightByCustomerId(
  db: Database,
  customerId: string,
): Promise<CustomerAiInsightView | null> {
  const [row] = await db
    .select()
    .from(schema.customerAiInsights)
    .where(eq(schema.customerAiInsights.customerId, customerId))
    .limit(1);

  return row ? formatCustomerAiInsight(row) : null;
}

/**
 * Ready upsert always writes `phase2Json` (including null) so a Base-only
 * refresh clears any previously stored Phase 2 payload on the same row.
 * @internal Exported for local D1 stale-clear tests.
 */
export async function persistReadyInsight(
  db: Database,
  customerId: string,
  output: CustomerInsightOutput,
  meta: {
    model: string;
    promptVersion: string;
    sourceHash: string;
    /** Final Phase2Insight JSON, or null to clear stale Phase 2. */
    phase2Json: string | null;
  },
): Promise<CustomerAiInsightView> {
  const now = new Date().toISOString();
  const existing = await getCustomerAiInsightByCustomerId(db, customerId);

  const values = {
    customerId,
    intentLevel: output.intentLevel,
    intentScore: output.intentScore,
    customerSummary: output.customerSummary,
    currentSituation: output.currentSituation,
    keySignalsJson: JSON.stringify(output.keySignals),
    riskFlagsJson: JSON.stringify(output.riskFlags),
    missingInformationJson: JSON.stringify(output.missingInformation),
    nextBestAction: output.nextBestAction,
    suggestedFollowUpAt: output.suggestedFollowUpAt,
    suggestedEmployeeMessage: output.suggestedEmployeeMessage,
    confidence: output.confidence,
    reasoning: output.reasoning,
    model: meta.model,
    promptVersion: meta.promptVersion,
    sourceHash: meta.sourceHash,
    phase2Json: meta.phase2Json,
    status: "ready" as const,
    generatedAt: now,
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(schema.customerAiInsights)
      .set(values)
      .where(eq(schema.customerAiInsights.customerId, customerId));
  } else {
    await db.insert(schema.customerAiInsights).values({
      id: crypto.randomUUID(),
      ...values,
      createdAt: now,
    });
  }

  const saved = await getCustomerAiInsightByCustomerId(db, customerId);
  if (!saved) {
    throw new Error("Failed to persist customer AI insight");
  }
  return saved;
}

async function persistFailedInsight(
  db: Database,
  customerId: string,
  meta: {
    model: string;
    promptVersion: string;
    sourceHash: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await getCustomerAiInsightByCustomerId(db, customerId);

  if (existing) {
    await db
      .update(schema.customerAiInsights)
      .set({
        status: "failed",
        model: meta.model,
        promptVersion: meta.promptVersion,
        sourceHash: meta.sourceHash,
        generatedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.customerAiInsights.customerId, customerId));
    return;
  }

  const placeholder = FAILED_PLACEHOLDER;
  await db.insert(schema.customerAiInsights).values({
    id: crypto.randomUUID(),
    customerId,
    intentLevel: placeholder.intentLevel,
    intentScore: placeholder.intentScore,
    customerSummary: placeholder.customerSummary,
    currentSituation: placeholder.currentSituation,
    keySignalsJson: JSON.stringify(placeholder.keySignals),
    riskFlagsJson: JSON.stringify(placeholder.riskFlags),
    missingInformationJson: JSON.stringify(placeholder.missingInformation),
    nextBestAction: placeholder.nextBestAction,
    suggestedFollowUpAt: placeholder.suggestedFollowUpAt,
    suggestedEmployeeMessage: placeholder.suggestedEmployeeMessage,
    confidence: placeholder.confidence,
    reasoning: placeholder.reasoning,
    model: meta.model,
    promptVersion: meta.promptVersion,
    sourceHash: meta.sourceHash,
    status: "failed",
    generatedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

export type CustomerAiInsightRefreshResult = {
  insight: CustomerAiInsightView;
  providerKind: AiProviderKind;
  phase2Generated: boolean;
  phase2UnavailableReason: Phase2FailureCode | null;
};

export function buildCustomerAiInsightRefreshAuditMetadata(
  insight: CustomerAiInsightView,
  providerKind: AiProviderKind,
  phase2Meta?: {
    phase2Generated: boolean;
    phase2UnavailableReason: Phase2FailureCode | null;
  },
) {
  return {
    customerId: insight.customerId,
    sourceHash: insight.sourceHash,
    model: insight.model,
    promptVersion: insight.promptVersion,
    status: insight.status,
    providerKind,
    phase2Generated: phase2Meta?.phase2Generated ?? insight.phase2 != null,
    phase2UnavailableReason: phase2Meta?.phase2UnavailableReason ?? null,
  };
}

export async function refreshCustomerAiInsight(
  db: Database,
  user: User,
  customer: Customer,
  accessOptions?: CustomerAccessOptions,
  options?: { reservationKey?: string },
): Promise<CustomerAiInsightRefreshResult> {
  const resolvedOptions =
    accessOptions ??
    (user.role === "staff"
      ? await resolveCustomerAccessOptions(db, user, customer.id)
      : {});

  // Customer permission must pass before any quota reservation.
  assertCanViewCustomerAiInsight(user, customer, resolvedOptions);

  const aiSettings = await getEffectiveAiSettings(db);
  assertCanRefreshCustomerAiInsight(user, aiSettings);

  if (!aiSettings.aiEnabled && !allowMockDeepInsightGeneration()) {
    throw new AiDeepAnalysisGlobalDisabledError();
  }

  const existingInsight = await getCustomerAiInsightByCustomerId(db, customer.id);
  if (isAiRefreshOnCooldown(existingInsight)) {
    throw new AiRefreshCooldownError();
  }

  const accessLevel = getCustomerAccessLevel(user, customer, resolvedOptions);
  const context = await buildCustomerInsightContext(db, customer.id, {
    accessLevel,
  });

  if (!context || context.customerId !== customer.id) {
    throw new Error("Failed to build customer insight context");
  }

  const sourceHash = await computeCustomerInsightSourceHash(context);
  const resolved = resolveCustomerInsightProvider(aiSettings);

  if (resolved.kind === "mock" && !allowMockDeepInsightGeneration()) {
    throw new AiDeepAnalysisMockOnlyError();
  }

  const provider = getCustomerInsightProviderImpl(resolved);

  let reservation: StaffAiReservationResult | null = null;
  const needsStaffQuota =
    user.role === "staff" && isExternalAiProviderKind(resolved.kind);

  if (needsStaffQuota && !aiSettings.aiStaffDeepAnalysisEnabled) {
    throw new AiStaffDeepAnalysisDisabledError();
  }

  if (needsStaffQuota) {
    try {
      reservation = await reserveStaffAiUsageForRefresh(db, {
        user,
        settings: aiSettings,
        reservationKey:
          options?.reservationKey?.trim() ||
          crypto.randomUUID(),
        customerId: customer.id,
        providerKind: resolved.kind,
      });
    } catch (error) {
      if (error instanceof StaffAiQuotaError) {
        if (error.code === "AI_STAFF_DEEP_ANALYSIS_DISABLED") {
          throw new AiStaffDeepAnalysisDisabledError(error.message);
        }
        if (error.code === "AI_STAFF_RESERVATION_CONFLICT") {
          throw new AiStaffReservationConflictError(error.message);
        }
        throw new AiStaffDailyLimitReachedError(error.message);
      }
      throw error;
    }
  }

  // Idempotent replay of a completed reservation: return stored insight, no provider call.
  if (reservation?.reused && reservation.status === "succeeded") {
    const existingReady = await getCustomerAiInsightByCustomerId(db, customer.id);
    if (existingReady && existingReady.status === "ready") {
      return {
        insight: existingReady,
        providerKind: resolved.kind,
        phase2Generated: existingReady.phase2 != null,
        phase2UnavailableReason: null,
      };
    }
  }

  // Cooldown guard: pre-write a failed record before the expensive provider call so
  // that a Worker CPU-limit kill (Error 1102) during the provider phase still sets
  // generatedAt, preventing an immediate retry that would repeat the same crash.
  if (resolved.kind === "openai_compatible") {
    await persistFailedInsight(db, customer.id, {
      model: resolved.model,
      promptVersion: aiSettings.aiPromptVersion,
      sourceHash,
    });
  }

  let rawOutput: unknown;
  try {
    rawOutput = await provider.analyzeCustomerInsight(
      context,
      aiSettings,
      resolved.config ?? undefined,
    );
  } catch (error) {
    if (reservation) {
      await failStaffAiUsage(db, reservation);
    }
    if (error instanceof AiConfigError) {
      throw error;
    }
    const diagnostics =
      error instanceof AiProviderError ? error.diagnostics : undefined;
    await persistFailedInsight(db, customer.id, {
      model: resolved.model,
      promptVersion: aiSettings.aiPromptVersion,
      sourceHash,
    });
    throw new AiAnalysisError(
      undefined,
      diagnostics,
      mapAiAnalysisErrorCode(diagnostics),
    );
  }

  // Mock / non-external providers must not fabricate Phase 2.
  const skipPhase2 = resolved.kind === "mock";
  const phase2ContractMode = resolveAiProviderPhase2ContractMode(resolved.kind);

  const combined = parseCombinedCustomerInsightProviderOutput(rawOutput, {
    phase2ContractMode: skipPhase2 ? "none" : phase2ContractMode,
  });
  if (!combined.success) {
    if (reservation) {
      await failStaffAiUsage(db, reservation);
    }
    const diagnostics = buildResolvedProviderDiagnostics(
      resolved,
      "schema_validation_failed",
    );
    await persistFailedInsight(db, customer.id, {
      model: resolved.model,
      promptVersion: aiSettings.aiPromptVersion,
      sourceHash,
    });
    throw new AiAnalysisError(
      undefined,
      diagnostics,
      mapAiAnalysisErrorCode(diagnostics),
    );
  }

  const parsedOutput = combined.output;

  let phase2Json: string | null = null;
  let phase2Generated = false;
  let phase2UnavailableReason: Phase2FailureCode | null = null;
  // Always sanitize suggested employee message before persist (never store non-compliant copy).
  let outputForPersist: CustomerInsightOutput = {
    ...parsedOutput,
    suggestedEmployeeMessage: sanitizeSuggestedEmployeeMessageForPersist(
      parsedOutput.suggestedEmployeeMessage,
    ),
  };

  if (skipPhase2) {
    phase2UnavailableReason = "missing_signals";
  } else {
    let effectiveSettings = null;
    try {
      effectiveSettings = await getEffectiveSettings(db);
    } catch {
      effectiveSettings = null;
    }

    const composed = composePhase2Insight({
      insightContext: context,
      signals: combined.phase2Signals,
      signalsStatus: combined.phase2SignalsStatus,
      baseMissingInformation: parsedOutput.missingInformation,
      suggestedEmployeeMessage: parsedOutput.suggestedEmployeeMessage,
      customer,
      settings: effectiveSettings,
    });

    outputForPersist = {
      ...parsedOutput,
      suggestedEmployeeMessage: composed.suggestedEmployeeMessage,
    };

    if (composed.ok) {
      phase2Json = serializePhase2Insight(composed.phase2);
      phase2Generated = true;
      phase2UnavailableReason = null;
    } else {
      phase2Json = null;
      phase2Generated = false;
      phase2UnavailableReason = composed.code;
    }
  }

  let insight;
  try {
    insight = await persistReadyInsight(db, customer.id, outputForPersist, {
      model: resolved.model,
      promptVersion: aiSettings.aiPromptVersion,
      sourceHash,
      phase2Json,
    });
  } catch (error) {
    // Valid provider output but no durable result for the user → do not keep succeeded count.
    if (reservation) {
      await failStaffAiUsage(db, reservation);
    }
    throw error;
  }

  if (reservation) {
    await completeStaffAiUsage(db, reservation);
  }

  return {
    insight,
    providerKind: resolved.kind,
    phase2Generated,
    phase2UnavailableReason,
  };
}

export async function getCustomerAiInsightForUser(
  db: Database,
  user: User,
  customer: Customer,
  accessOptions?: CustomerAccessOptions,
): Promise<CustomerAiInsightView | null> {
  const resolvedOptions =
    accessOptions ??
    (user.role === "staff"
      ? await resolveCustomerAccessOptions(db, user, customer.id)
      : {});
  assertCanViewCustomerAiInsight(user, customer, resolvedOptions);
  return getCustomerAiInsightByCustomerId(db, customer.id);
}

export async function getCustomerAiInsightBundleForUser(
  db: Database,
  user: User,
  customer: Customer,
  accessOptions?: CustomerAccessOptions,
): Promise<CustomerAiInsightBundle> {
  const aiSettings = await getEffectiveAiSettings(db);
  const storedInsight = await getCustomerAiInsightForUser(
    db,
    user,
    customer,
    accessOptions,
  );
  const staffUsage =
    user.role === "staff"
      ? await getStaffAiUsageSummary(db, user, aiSettings)
      : null;

  const deepAnalysis = isValidDeepInsight(storedInsight) ? storedInsight : null;
  const onCooldown = isAiRefreshOnCooldown(storedInsight);
  const deepAnalysisAvailability = resolveDeepAnalysisAvailability({
    user,
    settings: aiSettings,
    staffUsage,
    insight: storedInsight,
    providerConfigured: isAiApiKeyConfigured(),
    onCooldown,
  });

  let basicAnalysis: BasicCustomerAnalysis | null = null;
  try {
    basicAnalysis = await getBasicCustomerAnalysis(db, customer);
  } catch (error) {
    console.error("[basic-analysis] failed", {
      customerId: customer.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    basicAnalysis = null;
  }

  const display = getCustomerAiInsightDisplayMeta(
    user,
    aiSettings,
    staffUsage,
    deepAnalysisAvailability,
  );

  return {
    insight: deepAnalysis,
    display,
    basicAnalysis,
    deepAnalysis,
    deepAnalysisAvailability,
  };
}
