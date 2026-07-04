export const AI_SETTING_KEYS = [
  "ai_enabled",
  "ai_provider",
  "ai_api_base_url",
  "ai_model",
  "ai_temperature",
  "ai_max_tokens",
  "ai_timeout_ms",
  "ai_analysis_language",
  "ai_prompt_template",
  "ai_prompt_version",
  "ai_show_draft_message",
  "ai_staff_manual_refresh_enabled",
  "ai_admin_only_manual_refresh",
] as const;

export type AiSettingKey = (typeof AI_SETTING_KEYS)[number];

export const AI_PROVIDERS = ["mock", "openai_compatible", "google_gemini"] as const;
export type AiProviderKind = (typeof AI_PROVIDERS)[number];

export const AI_ANALYSIS_LANGUAGES = ["zh-Hant", "zh-Hans", "en"] as const;
export type AiAnalysisLanguage = (typeof AI_ANALYSIS_LANGUAGES)[number];

export const DEFAULT_AI_PROMPT_TEMPLATE = `Analyze the following CRM customer context and produce a structured intent assessment for internal staff use only.

Customer context JSON:
{{context_json}}

Return JSON only with these fields:
- intentLevel: "high" | "medium" | "low" | "unknown"
- intentScore: integer 0-100
- customerSummary: string
- currentSituation: string
- keySignals: string[]
- riskFlags: string[]
- missingInformation: string[]
- nextBestAction: string (see rules below)
- suggestedFollowUpAt: ISO-8601 string or null
- suggestedEmployeeMessage: string (see rules below)
- confidence: number 0-1
- reasoning: string

nextBestAction rules:
- Be concrete and action-oriented; do not only say "follow up" or "communicate further".
- Specify exactly what the staff member should do next.
- Include 2–3 practical questions to ask the client if key information is missing.
- Early-stage clients: suggest confirming goals, family situation, budget range, timeline, and main purpose.
- Clients with a clear direction: suggest arranging a basic assessment or eligibility/document review.
- If contactAvailability.hasWeChat is true, recommend WeChat as the preferred follow-up channel.
- Keep the advice realistic, warm, and low-pressure; do not over-promise.

suggestedEmployeeMessage rules:
- Write like a real staff member, not a customer service bot.
- Keep it short: 1–3 sentences, suitable for WeChat or SMS.
- Tone: polite, warm, professional, and low-pressure.
- Do not hard-sell; do not over-promise.
- It should be copyable by staff with minimal editing.
- If information is insufficient, ask 1–2 natural questions rather than immediately pushing a solution.`;


export const AI_SETTING_DEFAULTS: Record<AiSettingKey, string> = {
  ai_enabled: "false",
  ai_provider: "mock",
  ai_api_base_url: "https://api.openai.com",
  ai_model: "gpt-4o-mini",
  ai_temperature: "0.2",
  ai_max_tokens: "1200",
  ai_timeout_ms: "30000",
  ai_analysis_language: "zh-Hant",
  ai_prompt_template: DEFAULT_AI_PROMPT_TEMPLATE,
  ai_prompt_version: "phase-1c-v1",
  ai_show_draft_message: "true",
  ai_staff_manual_refresh_enabled: "true",
  ai_admin_only_manual_refresh: "false",
};

export const AI_SETTING_LABELS: Record<AiSettingKey, string> = {
  ai_enabled: "AI 功能总开关",
  ai_provider: "AI Provider",
  ai_api_base_url: "API Base URL",
  ai_model: "Model",
  ai_temperature: "Temperature",
  ai_max_tokens: "Max tokens",
  ai_timeout_ms: "Timeout (ms)",
  ai_analysis_language: "分析语言",
  ai_prompt_template: "Prompt 模板",
  ai_prompt_version: "Prompt version",
  ai_show_draft_message: "显示话术草稿",
  ai_staff_manual_refresh_enabled: "Staff 可手动刷新",
  ai_admin_only_manual_refresh: "仅 Admin 可刷新",
};

export const AI_LIMITS = {
  temperatureMin: 0,
  temperatureMax: 1,
  maxTokensMin: 256,
  maxTokensMax: 4096,
  timeoutMsMin: 5000,
  timeoutMsMax: 60000,
  promptTemplateMaxLength: 12000,
} as const;

export function isAiSettingKey(key: string): key is AiSettingKey {
  return (AI_SETTING_KEYS as readonly string[]).includes(key);
}

export function isAiProvider(value: string): value is AiProviderKind {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

export function isAiAnalysisLanguage(value: string): value is AiAnalysisLanguage {
  return (AI_ANALYSIS_LANGUAGES as readonly string[]).includes(value);
}

export function parseBooleanSetting(value: string): boolean {
  return value === "true" || value === "1";
}
