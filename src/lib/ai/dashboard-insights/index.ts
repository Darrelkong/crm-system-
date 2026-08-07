export { generateDashboardAiInsight } from "./service";
export { buildDashboardAiContext } from "./context";
export { buildDashboardAiContextFingerprint } from "./fingerprint";
export { StaffCustomerRefMap } from "./customer-ref";
export {
  clearDashboardAiCacheForTests,
} from "./cache";
export {
  clearDashboardAiRateLimitEventsForTests,
} from "./rate-limit";
export {
  clearDashboardAiLocalThrottleForTests,
} from "./best-effort-local-throttle";
export type {
  DashboardAiInsightType,
  DashboardAiInsightResult,
  DashboardAiInsightPayload,
  GenerateDashboardAiInsightInput,
} from "./types";
export {
  safeParseAdminBriefInsight,
  safeParseStaffTodayActionsInsight,
} from "./schemas";
export {
  allowMockDashboardInsightGeneration,
  isMockDashboardInsightBlockedInProduction,
  isProductionRuntime,
} from "./mock-constants";
