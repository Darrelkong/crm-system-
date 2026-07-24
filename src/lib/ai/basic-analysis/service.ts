import { desc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { Customer } from "../../../../drizzle/schema/customers";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { buildBasicAnalysisInput } from "@/lib/ai/basic-analysis/input";
import { buildBasicCustomerAnalysis } from "@/lib/ai/basic-analysis/rules";
import type { BasicCustomerAnalysis } from "@/lib/ai/basic-analysis/types";

/**
 * Latest follow-up next_action presence only — never returns body/summary text.
 * Uses customer_id index + LIMIT 1 with deterministic tie-break on id.
 */
export async function getLatestFollowUpNextActionPresence(
  db: Database,
  customerId: string,
): Promise<{ hasLatestNextAction: boolean; hasAnyFollowUp: boolean }> {
  const [row] = await db
    .select({
      nextAction: schema.followUps.nextAction,
      id: schema.followUps.id,
    })
    .from(schema.followUps)
    .where(eq(schema.followUps.customerId, customerId))
    .orderBy(desc(schema.followUps.followUpTime), desc(schema.followUps.id))
    .limit(1);

  const nextAction = row?.nextAction;
  const hasLatestNextAction =
    !!nextAction && nextAction.trim().length > 0;

  return {
    hasLatestNextAction,
    hasAnyFollowUp: !!row,
  };
}

/** @deprecated Alias — prefer getLatestFollowUpNextActionPresence. */
export const getLatestFollowUpNextAction = getLatestFollowUpNextActionPresence;

/**
 * Builds basic system analysis for a customer.
 * Isolated: rule failures should be handled by the caller.
 */
export async function getBasicCustomerAnalysis(
  db: Database,
  customer: Customer,
  now: Date = new Date(),
): Promise<BasicCustomerAnalysis> {
  // Soft-deleted / non-active customers: do not emit normal operational findings.
  if (customer.deletedAt || customer.status === "archived") {
    return {
      generatedAt: now.toISOString(),
      source: "system_rules",
      summaryStatus: "normal",
      findings: [],
      positiveSignals: [],
      missingData: [],
      nextRecommendedAction: null,
    };
  }

  const settings = await getEffectiveSettings(db);
  const latest = await getLatestFollowUpNextActionPresence(db, customer.id);
  const input = buildBasicAnalysisInput(customer, settings, {
    now,
    hasLatestNextAction: latest.hasLatestNextAction,
    hasAnyFollowUp:
      latest.hasAnyFollowUp ||
      !!(customer.lastFollowUpAt || customer.lastValidFollowUpAt),
  });
  return buildBasicCustomerAnalysis(input);
}
