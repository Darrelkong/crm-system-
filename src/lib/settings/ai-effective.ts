import type { Database } from "@/lib/db";
import {
  AI_SETTING_DEFAULTS,
  isAiProvider,
  parseBooleanSetting,
  type AiAnalysisLanguage,
  type AiProviderKind,
} from "@/lib/settings/ai-keys";
import { getAiSettings, type AiSettingsMap } from "@/lib/settings/ai-service";
import { normalizeAiApiBaseUrl, validateAiApiBaseUrl } from "@/lib/settings/ai-validation";

export type EffectiveAiSettings = {
  aiEnabled: boolean;
  aiProvider: AiProviderKind;
  aiApiBaseUrl: string;
  aiApiBaseUrlValid: boolean;
  aiModel: string;
  aiTemperature: number;
  aiMaxTokens: number;
  aiTimeoutMs: number;
  aiAnalysisLanguage: AiAnalysisLanguage;
  aiPromptTemplate: string;
  aiPromptVersion: string;
  aiShowDraftMessage: boolean;
  aiStaffManualRefreshEnabled: boolean;
  aiAdminOnlyManualRefresh: boolean;
};

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function parseEffectiveAiSettings(raw: AiSettingsMap): EffectiveAiSettings {
  const temperature = clampNumber(Number(raw.ai_temperature), 0, 1, 0.2);
  const maxTokens = clampNumber(
    Number(raw.ai_max_tokens),
    256,
    4096,
    Number(AI_SETTING_DEFAULTS.ai_max_tokens),
  );
  const timeoutMs = clampNumber(
    Number(raw.ai_timeout_ms),
    5000,
    60000,
    Number(AI_SETTING_DEFAULTS.ai_timeout_ms),
  );

  const normalizedRaw = normalizeAiApiBaseUrl(raw.ai_api_base_url);
  const baseUrl = normalizedRaw || AI_SETTING_DEFAULTS.ai_api_base_url;
  const aiApiBaseUrlValid = validateAiApiBaseUrl(baseUrl) === null;

  const language = (["zh-Hant", "zh-Hans", "en"] as const).includes(
    raw.ai_analysis_language as AiAnalysisLanguage,
  )
    ? (raw.ai_analysis_language as AiAnalysisLanguage)
    : "zh-Hant";

  const provider: AiProviderKind = isAiProvider(raw.ai_provider) ? raw.ai_provider : "mock";

  return {
    aiEnabled: parseBooleanSetting(raw.ai_enabled),
    aiProvider: provider,
    aiApiBaseUrl: baseUrl,
    aiApiBaseUrlValid,
    aiModel: raw.ai_model.trim() || AI_SETTING_DEFAULTS.ai_model,
    aiTemperature: temperature,
    aiMaxTokens: Math.round(maxTokens),
    aiTimeoutMs: Math.round(timeoutMs),
    aiAnalysisLanguage: language,
    aiPromptTemplate: raw.ai_prompt_template.trim() || AI_SETTING_DEFAULTS.ai_prompt_template,
    aiPromptVersion: raw.ai_prompt_version.trim() || AI_SETTING_DEFAULTS.ai_prompt_version,
    aiShowDraftMessage: parseBooleanSetting(raw.ai_show_draft_message),
    aiStaffManualRefreshEnabled: parseBooleanSetting(raw.ai_staff_manual_refresh_enabled),
    aiAdminOnlyManualRefresh: parseBooleanSetting(raw.ai_admin_only_manual_refresh),
  };
}

export async function getEffectiveAiSettings(db?: Database): Promise<EffectiveAiSettings> {
  const raw = await getAiSettings(db);
  return parseEffectiveAiSettings(raw);
}
