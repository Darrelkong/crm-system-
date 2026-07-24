/** Persisted model id used by the mock customer-insight provider. */
export const MOCK_CUSTOMER_INSIGHT_MODEL = "mock-customer-insight-v1";

/**
 * Known mock / non-production model ids that must never be shown as real
 * AI deep analysis. Includes the live mock provider id and a short legacy
 * test fixture value seen in purge-relations fixtures.
 */
export const MOCK_CUSTOMER_INSIGHT_MODEL_IDS: readonly string[] = [
  MOCK_CUSTOMER_INSIGHT_MODEL,
  "mock",
];

export function isMockCustomerInsightModel(model: string | null | undefined): boolean {
  if (!model) return false;
  if (MOCK_CUSTOMER_INSIGHT_MODEL_IDS.includes(model)) return true;
  return model.startsWith("mock-customer-insight");
}

/**
 * Server-env only. Never read from request headers/query/body.
 * Absent or any value other than "1" means mock deep generation is denied.
 */
export function allowMockDeepInsightGeneration(): boolean {
  return (
    process.env.CRM_ALLOW_TEST_DB_BIND === "1" ||
    process.env.CRM_ALLOW_MOCK_AI === "1"
  );
}
