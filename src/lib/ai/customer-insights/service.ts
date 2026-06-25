import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { getCustomerInsightProvider } from "@/lib/ai/providers/factory";
import { buildCustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { computeCustomerInsightSourceHash } from "@/lib/ai/customer-insights/hash";
import {
  PROMPT_VERSION,
  parseCustomerInsightOutput,
} from "@/lib/ai/customer-insights/schema";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import {
  assertCanViewCustomerAiInsight,
  getCustomerAccessLevel,
} from "@/lib/permissions/customers";
import type { CustomerAiInsight } from "../../../../drizzle/schema/customer-ai-insights";

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

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
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

export async function refreshCustomerAiInsight(
  db: Database,
  user: User,
  customer: Customer,
): Promise<CustomerAiInsightView> {
  assertCanViewCustomerAiInsight(user, customer);

  const accessLevel = getCustomerAccessLevel(user, customer);
  const context = await buildCustomerInsightContext(db, customer.id, {
    accessLevel,
  });

  if (!context || context.customerId !== customer.id) {
    throw new Error("Failed to build customer insight context");
  }

  const sourceHash = await computeCustomerInsightSourceHash(context);
  const provider = getCustomerInsightProvider();
  const rawOutput = await provider.analyzeCustomerInsight(context);
  const output = parseCustomerInsightOutput(rawOutput);

  const now = new Date().toISOString();
  const existing = await getCustomerAiInsightByCustomerId(db, customer.id);

  const values = {
    customerId: customer.id,
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
    model: provider.model,
    promptVersion: PROMPT_VERSION,
    sourceHash,
    status: "ready" as const,
    generatedAt: now,
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(schema.customerAiInsights)
      .set(values)
      .where(eq(schema.customerAiInsights.customerId, customer.id));
  } else {
    await db.insert(schema.customerAiInsights).values({
      id: crypto.randomUUID(),
      ...values,
      createdAt: now,
    });
  }

  const saved = await getCustomerAiInsightByCustomerId(db, customer.id);
  if (!saved) {
    throw new Error("Failed to persist customer AI insight");
  }

  return saved;
}

export async function getCustomerAiInsightForUser(
  db: Database,
  user: User,
  customer: Customer,
): Promise<CustomerAiInsightView | null> {
  assertCanViewCustomerAiInsight(user, customer);
  return getCustomerAiInsightByCustomerId(db, customer.id);
}
