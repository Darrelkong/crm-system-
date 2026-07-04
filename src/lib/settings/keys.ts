import { INACTIVITY_LOGOUT_MINUTES } from "@/lib/auth/constants";

export const LOCKED_SETTING_KEYS = ["inactivity_logout_minutes"] as const;

export type LockedSettingKey = (typeof LOCKED_SETTING_KEYS)[number];

export function isLockedSettingKey(key: string): key is LockedSettingKey {
  return (LOCKED_SETTING_KEYS as readonly string[]).includes(key);
}

export const SETTING_KEYS = [
  "automatic_reclaim_days",
  "reclaim_warning_days_before",
  /** @deprecated Superseded by reclaim_warning_days_before (E-4b). Kept for legacy DB rows. */
  "reclaim_warning_day_1",
  /** @deprecated Superseded by reclaim_warning_days_before (E-4b). Kept for legacy DB rows. */
  "reclaim_warning_day_2",
  "public_pool_claim_quota_7_days",
  "public_pool_claim_cooldown_hours",
  "first_contact_sla_hours",
  "inactivity_logout_minutes",
  "business_timezone",
  "device_authorization_enabled",
  "device_authorization_limit_per_user",
  /** When true, enables automatic collaborative dissolution (future C-4/C-5). Default off. */
  "collaborative_dissolution_enabled",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export const SETTING_DEFAULTS: Record<SettingKey, string> = {
  automatic_reclaim_days: "7",
  reclaim_warning_days_before: "3",
  reclaim_warning_day_1: "6",
  reclaim_warning_day_2: "7",
  public_pool_claim_quota_7_days: "5",
  public_pool_claim_cooldown_hours: "12",
  first_contact_sla_hours: "24",
  inactivity_logout_minutes: String(INACTIVITY_LOGOUT_MINUTES),
  business_timezone: "Asia/Shanghai",
  device_authorization_enabled: "false",
  device_authorization_limit_per_user: "2",
  collaborative_dissolution_enabled: "false",
};

export const SETTING_LABELS: Record<SettingKey, string> = {
  automatic_reclaim_days: "自动回收天数",
  reclaim_warning_days_before: "回收预警提前天数",
  reclaim_warning_day_1: "回收预警第 1 天（旧）",
  reclaim_warning_day_2: "回收预警第 2 天（旧）",
  public_pool_claim_quota_7_days: "7 天领取配额",
  public_pool_claim_cooldown_hours: "领取冷却（小时）",
  first_contact_sla_hours: "首次联系 SLA（小时）",
  inactivity_logout_minutes: "无操作登出（分钟）",
  business_timezone: "业务时区",
  device_authorization_enabled: "设备授权（启用后限制员工登录设备）",
  device_authorization_limit_per_user: "每位员工最多授权设备数",
  collaborative_dissolution_enabled: "共同负责自动解散（90 天未跟进）",
};

/**
 * Settings keys that should be hidden from the admin UI but remain readable/writable
 * via the API for backward compatibility. The deprecated day_1 / day_2 thresholds
 * were replaced by reclaim_warning_days_before in E-4b.
 */
export const HIDDEN_SETTING_KEYS = [
  "reclaim_warning_day_1",
  "reclaim_warning_day_2",
] as const satisfies readonly SettingKey[];

export function isHiddenSettingKey(key: string): boolean {
  return (HIDDEN_SETTING_KEYS as readonly string[]).includes(key);
}

export const ALLOWED_TIMEZONES = ["Asia/Shanghai", "UTC"] as const;
