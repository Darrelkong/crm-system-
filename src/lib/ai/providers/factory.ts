import { mockCustomerInsightProvider } from "./mock";
import type { CustomerInsightAIProvider } from "./types";

export function getCustomerInsightProvider(): CustomerInsightAIProvider {
  return mockCustomerInsightProvider;
}
