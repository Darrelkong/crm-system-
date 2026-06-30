import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";

/**
 * Returns a copy of customer insight context with structured contact fields removed
 * before sending to an external AI provider. Does not mutate the input.
 */
export function sanitizeCustomerInsightContextForProvider(
  context: CustomerInsightContext,
): CustomerInsightContext {
  return {
    customerId: context.customerId,
    customerName: context.customerName,
    customerType: context.customerType,
    salesStage: context.salesStage,
    source: context.source,
    status: context.status,
    requestedProjectName: context.requestedProjectName,
    sourceRemark: context.sourceRemark,
    notes: context.notes,
    lastFollowUpAt: context.lastFollowUpAt,
    lastValidFollowUpAt: context.lastValidFollowUpAt,
    nextFollowUpAt: context.nextFollowUpAt,
    updatedAt: context.updatedAt,
    includeSensitiveFields: false,
    phone: null,
    wechatId: null,
    email: null,
    recentFollowUps: context.recentFollowUps.map((followUp) => ({ ...followUp })),
  };
}
