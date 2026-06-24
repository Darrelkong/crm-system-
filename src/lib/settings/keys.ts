export const SETTING_KEYS = [
  "automatic_reclaim_days",
  "reclaim_warning_day_1",
  "reclaim_warning_day_2",
  "public_pool_claim_quota_7_days",
  "public_pool_claim_cooldown_hours",
  "first_contact_sla_hours",
  "inactivity_logout_minutes",
  "business_timezone",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export const SETTING_DEFAULTS: Record<SettingKey, string> = {
  automatic_reclaim_days: "8",
  reclaim_warning_day_1: "6",
  reclaim_warning_day_2: "7",
  public_pool_claim_quota_7_days: "5",
  public_pool_claim_cooldown_hours: "12",
  first_contact_sla_hours: "24",
  inactivity_logout_minutes: "30",
  business_timezone: "Asia/Shanghai",
};

export const SETTING_LABELS: Record<SettingKey, string> = {
  automatic_reclaim_days: "自动回收天数",
  reclaim_warning_day_1: "回收预警第 1 天",
  reclaim_warning_day_2: "回收预警第 2 天",
  public_pool_claim_quota_7_days: "7 天领取配额",
  public_pool_claim_cooldown_hours: "领取冷却（小时）",
  first_contact_sla_hours: "首次联系 SLA（小时）",
  inactivity_logout_minutes: "无操作登出（分钟）",
  business_timezone: "业务时区",
};

export const ALLOWED_TIMEZONES = ["Asia/Shanghai", "UTC"] as const;
