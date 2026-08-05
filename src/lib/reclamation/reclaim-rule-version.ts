import { inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { SETTING_DEFAULTS } from "@/lib/settings/keys";

const RECLAIM_RULE_SETTING_KEYS = [
  "automatic_reclaim_days",
  "reclaim_warning_days_before",
] as const;

/**
 * Stable reclaim-rule identity for risk episodes. Uses setting values plus the
 * latest `updated_at` across reclaim-related settings so 45→60→45 does not
 * collide with an earlier 45-day episode in the same cycle.
 */
export async function getReclaimRuleVersion(db: Database): Promise<string> {
  const rows = await db
    .select({
      key: schema.systemSettings.key,
      value: schema.systemSettings.value,
      updatedAt: schema.systemSettings.updatedAt,
    })
    .from(schema.systemSettings)
    .where(
      inArray(schema.systemSettings.key, [...RECLAIM_RULE_SETTING_KEYS]),
    );

  const byKey = new Map(rows.map((row) => [row.key, row]));
  const reclaimDays =
    byKey.get("automatic_reclaim_days")?.value ??
    SETTING_DEFAULTS.automatic_reclaim_days;
  const warningDaysBefore =
    byKey.get("reclaim_warning_days_before")?.value ??
    SETTING_DEFAULTS.reclaim_warning_days_before;
  const ruleUpdatedAt = rows
    .map((row) => row.updatedAt)
    .sort()
    .at(-1) ?? "";

  return `${reclaimDays}:${warningDaysBefore}:${ruleUpdatedAt}`;
}

export function buildRiskEpisodeKey(input: {
  customerId: string;
  ownerId: string;
  cycleStartedAt: string;
  reclaimRuleVersion: string;
}): string {
  return [
    input.customerId,
    input.ownerId,
    input.cycleStartedAt,
    input.reclaimRuleVersion,
  ].join(":");
}
