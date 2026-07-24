import type { User } from "../../../../drizzle/schema/users";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import type { StaffAiUsageSummary } from "@/lib/ai/staff-usage/service";
import { isExternalAiProviderKind } from "@/lib/ai/staff-usage/service";
import { isMockCustomerInsightModel } from "@/lib/ai/providers/mock-constants";
import { allowMockDeepInsightGeneration } from "@/lib/ai/providers/mock-constants";

type InsightIdentity = {
  status: string;
  model: string;
} | null | undefined;

export type DeepAnalysisAvailabilityReason =
  | "AVAILABLE"
  | "GLOBAL_DISABLED"
  | "STAFF_DISABLED"
  | "LIMIT_REACHED"
  | "PROVIDER_UNAVAILABLE"
  | "MOCK_ONLY"
  | "MANUAL_REFRESH_DISABLED"
  | "ADMIN_ONLY"
  | "PERMISSION_DENIED"
  | "COOLDOWN";

export type DeepAnalysisAvailability = {
  canViewCached: boolean;
  canGenerate: boolean;
  reason: DeepAnalysisAvailabilityReason;
  remaining: number | null;
  dailyLimit: number;
  usageDate: string | null;
  hasCachedInsight: boolean;
  cachedIsMock: boolean;
};

export function isMockDeepInsight(insight: InsightIdentity): boolean {
  if (!insight) return false;
  return isMockCustomerInsightModel(insight.model);
}

/** @deprecated Prefer isMockDeepInsight — alias kept for call-site clarity. */
export const isMockCustomerInsight = isMockDeepInsight;

/** Valid deep analysis for staff display — ready and not mock. */
export function isValidDeepInsight(insight: InsightIdentity): boolean {
  return !!insight && insight.status === "ready" && !isMockDeepInsight(insight);
}

export function resolveDeepAnalysisAvailability(input: {
  user: User;
  settings: EffectiveAiSettings;
  staffUsage: StaffAiUsageSummary | null;
  insight: InsightIdentity;
  providerConfigured: boolean;
  onCooldown?: boolean;
  /** Override for tests; defaults to env-based allowMockDeepInsightGeneration(). */
  allowMockGeneration?: boolean;
}): DeepAnalysisAvailability {
  const { user, settings, staffUsage, insight } = input;
  const validCached = isValidDeepInsight(insight);
  const cachedIsMock = isMockDeepInsight(insight);
  const dailyLimit = settings.aiStaffDailyLimit;
  const remaining =
    user.role === "staff" ? (staffUsage?.remaining ?? null) : null;
  const usageDate = staffUsage?.usageDate ?? null;

  const base = {
    canViewCached: validCached,
    remaining,
    dailyLimit,
    usageDate,
    hasCachedInsight: validCached,
    cachedIsMock,
  };

  const allowTestMock =
    input.allowMockGeneration ?? allowMockDeepInsightGeneration();

  if (!settings.aiEnabled && !allowTestMock) {
    return {
      ...base,
      canGenerate: false,
      reason: "GLOBAL_DISABLED",
    };
  }

  if (settings.aiProvider === "mock" && !allowTestMock) {
    return {
      ...base,
      canGenerate: false,
      reason: "MOCK_ONLY",
    };
  }

  // Production external path only; test mock harness may proceed past this gate.
  if (
    !allowTestMock &&
    !isExternalAiProviderKind(settings.aiProvider)
  ) {
    return {
      ...base,
      canGenerate: false,
      reason: "PROVIDER_UNAVAILABLE",
    };
  }

  if (
    !allowTestMock &&
    isExternalAiProviderKind(settings.aiProvider) &&
    !input.providerConfigured
  ) {
    return {
      ...base,
      canGenerate: false,
      reason: "PROVIDER_UNAVAILABLE",
    };
  }

  if (user.role === "staff") {
    if (settings.aiAdminOnlyManualRefresh) {
      return {
        ...base,
        canGenerate: false,
        reason: "ADMIN_ONLY",
      };
    }
    if (!settings.aiStaffManualRefreshEnabled) {
      return {
        ...base,
        canGenerate: false,
        reason: "MANUAL_REFRESH_DISABLED",
      };
    }
    if (!settings.aiStaffDeepAnalysisEnabled) {
      return {
        ...base,
        canGenerate: false,
        reason: "STAFF_DISABLED",
      };
    }
    if (staffUsage && staffUsage.remaining <= 0) {
      return {
        ...base,
        canGenerate: false,
        reason: "LIMIT_REACHED",
      };
    }
  }

  if (input.onCooldown) {
    return {
      ...base,
      canGenerate: false,
      reason: "COOLDOWN",
    };
  }

  return {
    ...base,
    canGenerate: true,
    reason: "AVAILABLE",
  };
}
