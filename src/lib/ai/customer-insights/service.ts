import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  getCustomerInsightProviderImpl,
  resolveCustomerInsightProvider,
} from "@/lib/ai/providers/factory";
import { buildCustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import {
  AiAnalysisError,
  AiConfigError,
  AiProviderError,
  AiRefreshDeniedError,
} from "@/lib/ai/customer-insights/errors";
import { buildResolvedProviderDiagnostics } from "@/lib/ai/customer-insights/diagnostics";
import { computeCustomerInsightSourceHash } from "@/lib/ai/customer-insights/hash";
import {
  safeParseCustomerInsightOutput,
  type CustomerInsightOutput,
} from "@/lib/ai/customer-insights/schema";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import {
  assertCanViewCustomerAiInsight,
  getCustomerAccessLevel,
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
};

export type CustomerAiInsightDisplayMeta = {
  showDraftMessage: boolean;
  canRefresh: boolean;
  refreshDisabledReason: "admin_only" | "staff_disabled" | null;
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
  };
}

export function getCustomerAiInsightDisplayMeta(
  user: User,
  settings: EffectiveAiSettings,
): CustomerAiInsightDisplayMeta {
  const canRefresh =
    user.role === "admin" ||
    (!settings.aiAdminOnlyManualRefresh && settings.aiStaffManualRefreshEnabled);

  let refreshDisabledReason: CustomerAiInsightDisplayMeta["refreshDisabledReason"] = null;
  if (!canRefresh) {
    refreshDisabledReason = settings.aiAdminOnlyManualRefresh
      ? "admin_only"
      : "staff_disabled";
  }

  return {
    showDraftMessage: settings.aiShowDraftMessage,
    canRefresh,
    refreshDisabledReason,
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

async function persistReadyInsight(
  db: Database,
  customerId: string,
  output: CustomerInsightOutput,
  meta: {
    model: string;
    promptVersion: string;
    sourceHash: string;
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
};

export function buildCustomerAiInsightRefreshAuditMetadata(
  insight: CustomerAiInsightView,
  providerKind: AiProviderKind,
) {
  return {
    customerId: insight.customerId,
    sourceHash: insight.sourceHash,
    model: insight.model,
    promptVersion: insight.promptVersion,
    status: insight.status,
    providerKind,
  };
}

export async function refreshCustomerAiInsight(
  db: Database,
  user: User,
  customer: Customer,
): Promise<CustomerAiInsightRefreshResult> {
  assertCanViewCustomerAiInsight(user, customer);

  const aiSettings = await getEffectiveAiSettings(db);
  assertCanRefreshCustomerAiInsight(user, aiSettings);

  const accessLevel = getCustomerAccessLevel(user, customer);
  const context = await buildCustomerInsightContext(db, customer.id, {
    accessLevel,
  });

  if (!context || context.customerId !== customer.id) {
    throw new Error("Failed to build customer insight context");
  }

  const sourceHash = await computeCustomerInsightSourceHash(context);
  const resolved = resolveCustomerInsightProvider(aiSettings);
  const provider = getCustomerInsightProviderImpl(resolved);

  let rawOutput: unknown;
  try {
    rawOutput = await provider.analyzeCustomerInsight(
      context,
      aiSettings,
      resolved.config ?? undefined,
    );
  } catch (error) {
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
    throw new AiAnalysisError(undefined, diagnostics);
  }

  const parsed = safeParseCustomerInsightOutput(rawOutput);
  if (!parsed.success) {
    await persistFailedInsight(db, customer.id, {
      model: resolved.model,
      promptVersion: aiSettings.aiPromptVersion,
      sourceHash,
    });
    throw new AiAnalysisError(
      undefined,
      buildResolvedProviderDiagnostics(resolved, "schema_validation_failed"),
    );
  }

  return {
    insight: await persistReadyInsight(db, customer.id, parsed.data, {
      model: resolved.model,
      promptVersion: aiSettings.aiPromptVersion,
      sourceHash,
    }),
    providerKind: resolved.kind,
  };
}

export async function getCustomerAiInsightForUser(
  db: Database,
  user: User,
  customer: Customer,
): Promise<CustomerAiInsightView | null> {
  assertCanViewCustomerAiInsight(user, customer);
  return getCustomerAiInsightByCustomerId(db, customer.id);
}

export async function getCustomerAiInsightBundleForUser(
  db: Database,
  user: User,
  customer: Customer,
): Promise<{
  insight: CustomerAiInsightView | null;
  display: CustomerAiInsightDisplayMeta;
}> {
  const aiSettings = await getEffectiveAiSettings(db);
  const insight = await getCustomerAiInsightForUser(db, user, customer);
  return {
    insight,
    display: getCustomerAiInsightDisplayMeta(user, aiSettings),
  };
}
