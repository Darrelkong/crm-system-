/** Server-env only mock guard for dashboard AI insights. */
export const MOCK_DASHBOARD_INSIGHT_MODEL = "mock-dashboard-insight-v1";

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Mock dashboard AI is allowed only outside production:
 * - `NODE_ENV=test`, or
 * - explicit local allow flags in non-production runtimes.
 */
export function allowMockDashboardInsightGeneration(): boolean {
  if (isProductionRuntime()) {
    return false;
  }
  return (
    process.env.NODE_ENV === "test" ||
    process.env.CRM_ALLOW_MOCK_AI === "1" ||
    process.env.CRM_ALLOW_TEST_DB_BIND === "1"
  );
}

/** Production must never return mock AI output, regardless of allow flags. */
export function isMockDashboardInsightBlockedInProduction(): boolean {
  return isProductionRuntime();
}
