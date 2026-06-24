import {
  ALLOWED_TIMEZONES,
  SETTING_KEYS,
  type SettingKey,
} from "@/lib/settings/keys";

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

export function validateSettingValue(
  key: SettingKey,
  value: string,
): string | null {
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

  if (key === "public_pool_claim_quota_7_days" && num <= 0) {
    return "领取配额必须大于 0";
  }

  return null;
}
