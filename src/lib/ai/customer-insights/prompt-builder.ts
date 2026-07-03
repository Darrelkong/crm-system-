import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { sanitizeCustomerInsightContextForProvider } from "@/lib/ai/customer-insights/context-sanitize";
import type { AiAnalysisLanguage } from "@/lib/settings/ai-keys";

const LANGUAGE_LABELS: Record<AiAnalysisLanguage, string> = {
  "zh-Hant": "繁體中文",
  "zh-Hans": "简体中文",
  en: "English",
};

export function serializeCustomerInsightContext(context: CustomerInsightContext): string {
  const sanitized = sanitizeCustomerInsightContextForProvider(context);

  return JSON.stringify(
    {
      customerId: sanitized.customerId,
      customerName: sanitized.customerName,
      customerType: sanitized.customerType,
      salesStage: sanitized.salesStage,
      source: sanitized.source,
      status: sanitized.status,
      requestedProjectName: sanitized.requestedProjectName,
      sourceRemark: sanitized.sourceRemark,
      notes: sanitized.notes,
      phone: sanitized.phone,
      wechatId: sanitized.wechatId,
      email: sanitized.email,
      lastFollowUpAt: sanitized.lastFollowUpAt,
      lastValidFollowUpAt: sanitized.lastValidFollowUpAt,
      nextFollowUpAt: sanitized.nextFollowUpAt,
      updatedAt: sanitized.updatedAt,
      recentFollowUps: sanitized.recentFollowUps,
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
    "- Return only one valid JSON object.",
    "- Do not include markdown fences or extra commentary.",
    "- Do not include explanations before or after the JSON.",
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
