import {
  ALLOWED_TIMEZONES,
  SETTING_KEYS,
  type SettingKey,
} from "@/lib/settings/keys";
import type { SettingsMap } from "@/lib/settings/service";

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

export function validateSettingValue(
  key: SettingKey,
  value: string,
): string | null {
  if (
    key === "device_authorization_enabled" ||
    key === "collaborative_dissolution_enabled" ||
    key === "global_idle_timeout_exempt_enabled"
  ) {
    if (value !== "true" && value !== "false") {
      return "必须为 true 或 false";
    }
    return null;
  }

  if (key === "business_timezone") {
    if (!(ALLOWED_TIMEZONES as readonly string[]).includes(value)) {
      return "时区仅允许 Asia/Shanghai 或 UTC";
    }
    return null;
  }

  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || !Number.isInteger(num)) {
    return "必须为正整数";
  }

  if (key === "reclaim_warning_days_before" && num < 1) {
    return "必须大于等于 1";
  }

  return null;
}

/** Cross-field rules after merging current settings with pending updates. */
export function validateSettingsConsistency(
  settings: SettingsMap,
): string | null {
  const daysBefore = Number(settings.reclaim_warning_days_before);
  const reclaim = Number(settings.automatic_reclaim_days);

  if (!Number.isFinite(reclaim) || reclaim < 1) {
    return "automatic_reclaim_days 必须大于等于 1";
  }
  if (!Number.isFinite(daysBefore) || daysBefore < 1) {
    return "reclaim_warning_days_before 必须大于等于 1";
  }
  if (daysBefore >= reclaim) {
    return "reclaim_warning_days_before 必须小于 automatic_reclaim_days";
  }

  const quota = Number(settings.public_pool_claim_quota_7_days);
  if (!Number.isFinite(quota) || quota <= 0) {
    return "public_pool_claim_quota_7_days 必须大于 0";
  }

  const cooldown = Number(settings.public_pool_claim_cooldown_hours);
  if (!Number.isFinite(cooldown) || cooldown <= 0) {
    return "public_pool_claim_cooldown_hours 必须大于 0";
  }

  const sla = Number(settings.first_contact_sla_hours);
  if (!Number.isFinite(sla) || sla <= 0) {
    return "first_contact_sla_hours 必须大于 0";
  }

  const inactivity = Number(settings.inactivity_logout_minutes);
  if (!Number.isFinite(inactivity) || inactivity <= 0) {
    return "inactivity_logout_minutes 必须大于 0";
  }

  if (
    !(ALLOWED_TIMEZONES as readonly string[]).includes(
      settings.business_timezone,
    )
  ) {
    return "business_timezone 只能是 Asia/Shanghai 或 UTC";
  }

  return null;
}

export function validateSettingsPatch(
  current: SettingsMap,
  updates: Record<string, string>,
): string | null {
  const merged = { ...current };

  for (const [rawKey, rawValue] of Object.entries(updates)) {
    if (!isSettingKey(rawKey)) {
      return `未知配置项：${rawKey}`;
    }
    const value = String(rawValue).trim();
    const fieldError = validateSettingValue(rawKey, value);
    if (fieldError) {
      return `${rawKey}: ${fieldError}`;
    }
    merged[rawKey] = value;
  }

  return validateSettingsConsistency(merged);
}
