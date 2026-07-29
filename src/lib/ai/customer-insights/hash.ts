import type { CustomerInsightContext } from "./context-builder";
import { customerInsightProfileForHash } from "./customer-profile-context";

const RECENT_FOLLOW_UP_LIMIT = 10;

export async function computeCustomerInsightSourceHash(
  context: CustomerInsightContext,
): Promise<string> {
  const customerProfile = customerInsightProfileForHash(context.customerProfile);

  const payload = {
    customerId: context.customerId,
    customer: {
      customerName: context.customerName,
      nameStatus: context.nameStatus,
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
      nextAction: row.nextAction,
      customerIntent: row.customerIntent,
      isValidFollowUp: row.isValidFollowUp,
      nextFollowUpAt: row.nextFollowUpAt,
    })),
    // Omit when empty so legacy customers without profile keep compatible hashes.
    ...(customerProfile ? { customerProfile } : {}),
  };

  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
