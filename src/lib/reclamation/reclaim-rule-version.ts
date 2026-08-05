import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { SETTING_DEFAULTS } from "@/lib/settings/keys";

const AUTOMATIC_RECLAIM_DAYS_KEY = "automatic_reclaim_days";

export type AutomaticReclaimRuleState = {
  reclaimDays: number;
  /** Changes only when `automatic_reclaim_days` value is saved with a new value. */
  ruleVersion: string;
};

export async function getAutomaticReclaimRuleState(
  db: Database,
): Promise<AutomaticReclaimRuleState> {
  const row = await db
    .select({
      value: schema.systemSettings.value,
      updatedAt: schema.systemSettings.updatedAt,
    })
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, AUTOMATIC_RECLAIM_DAYS_KEY))
    .limit(1);

  const reclaimDays = Number.parseInt(
    row[0]?.value ?? SETTING_DEFAULTS.automatic_reclaim_days,
    10,
  );
  const ruleVersion = row[0]?.updatedAt ?? "default";

  return {
    reclaimDays: Number.isFinite(reclaimDays) ? reclaimDays : Number(SETTING_DEFAULTS.automatic_reclaim_days),
    ruleVersion,
  };
}

/** @deprecated Use getAutomaticReclaimRuleState().ruleVersion */
export async function getReclaimRuleVersion(db: Database): Promise<string> {
  const state = await getAutomaticReclaimRuleState(db);
  return state.ruleVersion;
}

export function buildRiskEpisodeKey(input: {
  customerId: string;
  ownerId: string;
  cycleStartedAt: string;
  reclaimDays: number;
  reclaimRuleVersion: string;
}): string {
  return [
    input.customerId,
    input.ownerId,
    input.cycleStartedAt,
    String(input.reclaimDays),
    input.reclaimRuleVersion,
  ].join(":");
}
