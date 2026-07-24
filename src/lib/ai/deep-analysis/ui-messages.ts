import type { DeepAnalysisAvailabilityReason } from "@/lib/ai/deep-analysis/availability";

/** i18n key for deep-analysis availability / status banners. */
export function deepAnalysisStatusMessageKey(
  reason: DeepAnalysisAvailabilityReason,
  options: { hasCachedInsight: boolean } = { hasCachedInsight: false },
): string {
  switch (reason) {
    case "AVAILABLE":
      return "customers.deepAnalysis.status.available";
    case "STAFF_DISABLED":
      return "customers.deepAnalysis.status.staffDisabled";
    case "LIMIT_REACHED":
      return "customers.deepAnalysis.status.limitReached";
    case "GLOBAL_DISABLED":
      return "customers.deepAnalysis.status.globalDisabled";
    case "PROVIDER_UNAVAILABLE":
      return "customers.deepAnalysis.status.providerUnavailable";
    case "MOCK_ONLY":
      return "customers.deepAnalysis.status.mockOnly";
    case "MANUAL_REFRESH_DISABLED":
      return "customers.deepAnalysis.status.manualRefreshDisabled";
    case "ADMIN_ONLY":
      return "customers.deepAnalysis.status.adminOnly";
    case "COOLDOWN":
      return "customers.deepAnalysis.status.cooldown";
    case "PERMISSION_DENIED":
      return "customers.deepAnalysis.status.permissionDenied";
    default:
      return options.hasCachedInsight
        ? "customers.deepAnalysis.status.cachedReadOnly"
        : "customers.deepAnalysis.status.empty";
  }
}

export function basicAnalysisSummaryStatusKey(
  status: "normal" | "attention" | "urgent",
): string {
  switch (status) {
    case "urgent":
      return "customers.basicAnalysis.summary.urgent";
    case "attention":
      return "customers.basicAnalysis.summary.attention";
    default:
      return "customers.basicAnalysis.summary.normal";
  }
}
