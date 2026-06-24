import type { Database } from "@/lib/db";
import {
  ALLOWED_TIMEZONES,
  SETTING_DEFAULTS,
  type SettingKey,
} from "@/lib/settings/keys";
import { getSystemSettings, type SettingsMap } from "@/lib/settings/service";

export type BusinessTimezone = (typeof ALLOWED_TIMEZONES)[number];

export type EffectiveSettings = {
  automaticReclaimDays: number;
  reclaimWarningDay1: number;
  reclaimWarningDay2: number;
  publicPoolClaimQuota7Days: number;
  publicPoolClaimCooldownHours: number;
  firstContactSlaHours: number;
  businessTimezone: BusinessTimezone;
  inactivityLogoutMinutes: number;
};

function warnInvalid(key: string, raw: string, fallback: number): number {
  console.warn(
    `[settings] Invalid ${key}="${raw}", using default ${fallback}`,
  );
  return fallback;
}

function parsePositiveInt(
  raw: string,
  defaultValue: number,
  key: string,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    return warnInvalid(key, raw, defaultValue);
  }
  return n;
}

function parseTimezone(raw: string): BusinessTimezone {
  if ((ALLOWED_TIMEZONES as readonly string[]).includes(raw)) {
    return raw as BusinessTimezone;
  }
  console.warn(
    `[settings] Invalid business_timezone="${raw}", using default Asia/Shanghai`,
  );
  return "Asia/Shanghai";
}

/** Parse settings map into typed values; invalid stored values fall back to defaults. */
export function parseEffectiveSettings(raw: SettingsMap): EffectiveSettings {
  let reclaimWarningDay1 = parsePositiveInt(
    raw.reclaim_warning_day_1,
    Number(SETTING_DEFAULTS.reclaim_warning_day_1),
    "reclaim_warning_day_1",
  );
  let reclaimWarningDay2 = parsePositiveInt(
    raw.reclaim_warning_day_2,
    Number(SETTING_DEFAULTS.reclaim_warning_day_2),
    "reclaim_warning_day_2",
  );
  let automaticReclaimDays = parsePositiveInt(
    raw.automatic_reclaim_days,
    Number(SETTING_DEFAULTS.automatic_reclaim_days),
    "automatic_reclaim_days",
  );

  if (reclaimWarningDay1 < 1) {
    reclaimWarningDay1 = Number(SETTING_DEFAULTS.reclaim_warning_day_1);
  }
  if (
    reclaimWarningDay2 <= reclaimWarningDay1 ||
    automaticReclaimDays <= reclaimWarningDay2
  ) {
    console.warn(
      "[settings] Invalid reclaim day ordering in stored settings, using defaults 6/7/8",
    );
    reclaimWarningDay1 = Number(SETTING_DEFAULTS.reclaim_warning_day_1);
    reclaimWarningDay2 = Number(SETTING_DEFAULTS.reclaim_warning_day_2);
    automaticReclaimDays = Number(SETTING_DEFAULTS.automatic_reclaim_days);
  }

  return {
    automaticReclaimDays,
    reclaimWarningDay1,
    reclaimWarningDay2,
    publicPoolClaimQuota7Days: parsePositiveInt(
      raw.public_pool_claim_quota_7_days,
      Number(SETTING_DEFAULTS.public_pool_claim_quota_7_days),
      "public_pool_claim_quota_7_days",
    ),
    publicPoolClaimCooldownHours: parsePositiveInt(
      raw.public_pool_claim_cooldown_hours,
      Number(SETTING_DEFAULTS.public_pool_claim_cooldown_hours),
      "public_pool_claim_cooldown_hours",
    ),
    firstContactSlaHours: parsePositiveInt(
      raw.first_contact_sla_hours,
      Number(SETTING_DEFAULTS.first_contact_sla_hours),
      "first_contact_sla_hours",
    ),
    businessTimezone: parseTimezone(raw.business_timezone),
    inactivityLogoutMinutes: parsePositiveInt(
      raw.inactivity_logout_minutes,
      Number(SETTING_DEFAULTS.inactivity_logout_minutes),
      "inactivity_logout_minutes",
    ),
  };
}

export async function getEffectiveSettings(
  db?: Database,
): Promise<EffectiveSettings> {
  const raw = await getSystemSettings(db);
  return parseEffectiveSettings(raw);
}
