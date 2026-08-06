/** Server-env only mock guard for dashboard AI insights. */
export const MOCK_DASHBOARD_INSIGHT_MODEL = "mock-dashboard-insight-v1";

export function allowMockDashboardInsightGeneration(): boolean {
  return (
    process.env.CRM_ALLOW_TEST_DB_BIND === "1" ||
    process.env.CRM_ALLOW_MOCK_AI === "1" ||
    process.env.NODE_ENV === "test"
  );
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function isMockDashboardInsightBlockedInProduction(): boolean {
  return isProductionRuntime() && !allowMockDashboardInsightGeneration();
}
