import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import {
  AI_CONTEXT_FOLLOW_UP_INTENT_MAX_CHARS,
  AI_CONTEXT_FOLLOW_UP_SUMMARY_MAX_CHARS,
  AI_CONTEXT_NOTES_MAX_CHARS,
  AI_CONTEXT_SOURCE_REMARK_MAX_CHARS,
  AI_CONTEXT_TRUNCATION_SUFFIX,
} from "@/lib/ai/customer-insights/limits";

function truncateField(value: string | null, maxChars: number): string | null {
  if (!value || value.length <= maxChars) return value;
  return value.slice(0, maxChars) + AI_CONTEXT_TRUNCATION_SUFFIX;
}

/**
 * Returns a copy of customer insight context with structured contact fields removed
 * and free-text fields truncated to safe lengths before sending to an external AI
 * provider. Does not mutate the input.
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
    sourceRemark: truncateField(context.sourceRemark, AI_CONTEXT_SOURCE_REMARK_MAX_CHARS),
    notes: truncateField(context.notes, AI_CONTEXT_NOTES_MAX_CHARS),
    lastFollowUpAt: context.lastFollowUpAt,
    lastValidFollowUpAt: context.lastValidFollowUpAt,
    nextFollowUpAt: context.nextFollowUpAt,
    updatedAt: context.updatedAt,
    includeSensitiveFields: false,
    phone: null,
    wechatId: null,
    email: null,
    recentFollowUps: context.recentFollowUps.map((followUp) => ({
      ...followUp,
      summary: truncateField(followUp.summary, AI_CONTEXT_FOLLOW_UP_SUMMARY_MAX_CHARS) ?? followUp.summary,
      customerIntent: truncateField(followUp.customerIntent, AI_CONTEXT_FOLLOW_UP_INTENT_MAX_CHARS),
    })),
  };
}
