import type { CustomerInsightContext } from "./context-builder";

const RECENT_FOLLOW_UP_LIMIT = 10;

export async function computeCustomerInsightSourceHash(
  context: CustomerInsightContext,
): Promise<string> {
  const payload = {
    customerId: context.customerId,
    customer: {
      customerName: context.customerName,
      customerType: context.customerType,
      salesStage: context.salesStage,
      source: context.source,
      status: context.status,
      requestedProjectName: context.requestedProjectName,
      lastFollowUpAt: context.lastFollowUpAt,
      lastValidFollowUpAt: context.lastValidFollowUpAt,
      nextFollowUpAt: context.nextFollowUpAt,
      updatedAt: context.updatedAt,
    },
    recentFollowUps: context.recentFollowUps.slice(0, RECENT_FOLLOW_UP_LIMIT).map((row) => ({
      id: row.id,
      followUpTime: row.followUpTime,
      channel: row.channel,
      outcome: row.outcome,
      summary: row.summary,
      customerIntent: row.customerIntent,
      isValidFollowUp: row.isValidFollowUp,
      nextFollowUpAt: row.nextFollowUpAt,
    })),
  };

  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
