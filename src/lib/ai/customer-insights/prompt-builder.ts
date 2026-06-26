import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import type { AiAnalysisLanguage } from "@/lib/settings/ai-keys";

const LANGUAGE_LABELS: Record<AiAnalysisLanguage, string> = {
  "zh-Hant": "繁體中文",
  "zh-Hans": "简体中文",
  en: "English",
};

export function serializeCustomerInsightContext(context: CustomerInsightContext): string {
  return JSON.stringify(
    {
      customerId: context.customerId,
      customerName: context.customerName,
      customerType: context.customerType,
      salesStage: context.salesStage,
      source: context.source,
      status: context.status,
      requestedProjectName: context.requestedProjectName,
      sourceRemark: context.sourceRemark,
      notes: context.notes,
      phone: context.phone,
      wechatId: context.wechatId,
      email: context.email,
      lastFollowUpAt: context.lastFollowUpAt,
      lastValidFollowUpAt: context.lastValidFollowUpAt,
      nextFollowUpAt: context.nextFollowUpAt,
      updatedAt: context.updatedAt,
      recentFollowUps: context.recentFollowUps,
    },
    null,
    2,
  );
}

export function buildSystemPrompt(analysisLanguage: AiAnalysisLanguage): string {
  const languageLabel = LANGUAGE_LABELS[analysisLanguage];
  return [
    "You are an internal CRM assistant for sales staff.",
    "Your job is to analyze one customer record and return structured JSON only.",
    "Rules:",
    "- Output must be valid JSON matching the requested schema.",
    "- Do not include markdown fences or extra commentary.",
    "- Do not promise outcomes to the customer.",
    "- Do not change or recommend changing sales stage, customer status, or CRM records.",
    "- Do not send messages to the customer automatically.",
    "- Suggestions are for internal staff reference only.",
    `- Write all human-readable text fields in ${languageLabel}.`,
  ].join("\n");
}

export function buildUserPrompt(
  promptTemplate: string,
  context: CustomerInsightContext,
): string {
  const contextJson = serializeCustomerInsightContext(context);
  if (promptTemplate.includes("{{context_json}}")) {
    return promptTemplate.replaceAll("{{context_json}}", contextJson);
  }
  return `${promptTemplate.trim()}\n\nCustomer context JSON:\n${contextJson}`;
}
