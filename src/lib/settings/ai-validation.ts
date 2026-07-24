import {
  AI_LIMITS,
  AI_SETTING_DEFAULTS,
  isAiAnalysisLanguage,
  isAiProvider,
  isAiSettingKey,
  type AiSettingKey,
} from "@/lib/settings/ai-keys";
import type { AiSettingsMap } from "@/lib/settings/ai-service";

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;

  if (value === 0) return true;
  if ((value & 0xff000000) === 0x7f000000) return true;
  if ((value & 0xff000000) === 0x0a000000) return true;
  if ((value & 0xfff00000) === 0xac100000) return true;
  if ((value & 0xffff0000) === 0xc0a80000) return true;
  if ((value & 0xffff0000) === 0xa9fe0000) return true;

  return false;
}

function isBlockedIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "::1" || normalized === "[::1]";
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  if (normalized.endsWith(".localhost")) return true;
  if (isBlockedIpv4(normalized)) return true;
  if (isBlockedIpv6(normalized)) return true;
  return false;
}

export function normalizeAiApiBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function validateAiApiBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return "ai_api_base_url 不能为空";
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "ai_api_base_url 必须是有效 URL";
  }

  if (url.protocol !== "https:") {
    return "ai_api_base_url 必须是 https URL";
  }

  if (url.username || url.password) {
    return "ai_api_base_url 不允许包含用户名或密码";
  }

  if (isBlockedHostname(url.hostname)) {
    return "ai_api_base_url 不允许指向本地或内网地址";
  }

  return null;
}

function validateBoolean(key: AiSettingKey, value: string): string | null {
  if (value !== "true" && value !== "false") {
    return `${key} 必须为 true 或 false`;
  }
  return null;
}

function validateNumberInRange(
  key: AiSettingKey,
  value: string,
  min: number,
  max: number,
  integer = false,
): string | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    return `${key} 必须在 ${min} 到 ${max} 之间`;
  }
  if (integer && !Number.isInteger(num)) {
    return `${key} 必须为整数`;
  }
  return null;
}

export function validateAiSettingValue(key: AiSettingKey, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return `${key} 不能为空`;
  }

  switch (key) {
    case "ai_enabled":
    case "ai_show_draft_message":
    case "ai_staff_manual_refresh_enabled":
    case "ai_admin_only_manual_refresh":
    case "ai_staff_deep_analysis_enabled":
      return validateBoolean(key, trimmed);
    case "ai_provider":
      return isAiProvider(trimmed) ? null : `${key} 仅允许 mock、openai_compatible 或 google_gemini`;
    case "ai_api_base_url":
      return validateAiApiBaseUrl(trimmed);
    case "ai_model":
      return trimmed.length <= 128 ? null : `${key} 过长`;
    case "ai_temperature":
      return validateNumberInRange(key, trimmed, AI_LIMITS.temperatureMin, AI_LIMITS.temperatureMax);
    case "ai_max_tokens":
      return validateNumberInRange(
        key,
        trimmed,
        AI_LIMITS.maxTokensMin,
        AI_LIMITS.maxTokensMax,
        true,
      );
    case "ai_timeout_ms":
      return validateNumberInRange(
        key,
        trimmed,
        AI_LIMITS.timeoutMsMin,
        AI_LIMITS.timeoutMsMax,
        true,
      );
    case "ai_analysis_language":
      return isAiAnalysisLanguage(trimmed) ? null : `${key} 仅允许 zh-Hant、zh-Hans 或 en`;
    case "ai_prompt_template":
      return trimmed.length <= AI_LIMITS.promptTemplateMaxLength
        ? null
        : `${key} 过长（最多 ${AI_LIMITS.promptTemplateMaxLength} 字符）`;
    case "ai_prompt_version":
      return trimmed.length <= 64 ? null : `${key} 过长`;
    case "ai_staff_daily_limit":
      return validateNumberInRange(
        key,
        trimmed,
        AI_LIMITS.staffDailyLimitMin,
        AI_LIMITS.staffDailyLimitMax,
        true,
      );
    default:
      return null;
  }
}

export function validateAiSettingsPatch(
  updates: Record<string, string>,
): string | null {
  for (const [rawKey, rawValue] of Object.entries(updates)) {
    if (!isAiSettingKey(rawKey)) {
      return `未知 AI 配置项：${rawKey}`;
    }
    const error = validateAiSettingValue(rawKey, String(rawValue));
    if (error) {
      return error;
    }
  }
  return null;
}

export function mergeAiSettings(
  current: AiSettingsMap,
  updates: Record<string, string>,
): AiSettingsMap {
  const merged = { ...current };
  for (const [rawKey, rawValue] of Object.entries(updates)) {
    if (isAiSettingKey(rawKey)) {
      merged[rawKey] = String(rawValue).trim();
    }
  }
  if (merged.ai_prompt_template.trim() === "") {
    merged.ai_prompt_template = AI_SETTING_DEFAULTS.ai_prompt_template;
  }
  return merged;
}
