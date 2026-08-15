import { eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { CLAIM_QUOTA_DAYS, type StaffClaimStatus } from "./constants";
import {
  recordPublicPoolClaimHistoryPhysicalLoad,
  recordPublicPoolSettingsPhysicalLoad,
} from "./public-pool-instrumentation";

function buildStaffClaimStatusFromHistory(input: {
  claimedInLast7Days: number;
  lastClaimedAt: string | null | undefined;
  quotaLimit: number;
  cooldownHours: number;
  now: Date;
}): StaffClaimStatus {
  const { claimedInLast7Days, lastClaimedAt, quotaLimit, cooldownHours, now } =
    input;
  const cooldownMs = cooldownHours * 60 * 60 * 1000;
  const remainingQuota = Math.max(0, quotaLimit - claimedInLast7Days);

  let cooldownUntil: string | null = null;
  let inCooldown = false;

  if (lastClaimedAt) {
    const cooldownEnd = new Date(
      new Date(lastClaimedAt).getTime() + cooldownMs,
    );
    if (cooldownEnd > now) {
      inCooldown = true;
      cooldownUntil = cooldownEnd.toISOString();
    }
  }

  let blockedReasonKey: string | null = null;
  let blockedReasonParams: Record<string, string> | undefined;
  let canClaimNow = true;

  if (inCooldown) {
    canClaimNow = false;
    blockedReasonKey = "cooldown";
    blockedReasonParams = { hours: String(cooldownHours) };
  } else if (remainingQuota <= 0) {
    canClaimNow = false;
    blockedReasonKey = "quotaExceeded";
    blockedReasonParams = { limit: String(quotaLimit) };
  }

  return {
    claimedInLast7Days,
    remainingQuota,
    quotaLimit,
    cooldownHours,
    cooldownUntil,
    inCooldown,
    canClaimNow,
    blockedReasonKey,
    blockedReasonParams,
  };
}

async function loadStaffClaimHistoryAggregate(
  database: Database,
  userId: string,
  sevenDaysAgo: string,
): Promise<{ claimedInLast7Days: number; lastClaimedAt: string | null }> {
  recordPublicPoolClaimHistoryPhysicalLoad();

  const [row] = await database
    .select({
      claimedInLast7Days:
        sql<number>`coalesce(sum(case when ${schema.customers.claimedAt} >= ${sevenDaysAgo} then 1 else 0 end), 0)`.mapWith(
          Number,
        ),
      lastClaimedAt: sql<string | null>`max(${schema.customers.claimedAt})`,
    })
    .from(schema.customers)
    .where(eq(schema.customers.claimedBy, userId));

  return {
    claimedInLast7Days: Number(row?.claimedInLast7Days ?? 0),
    lastClaimedAt: row?.lastClaimedAt ?? null,
  };
}

export async function getStaffClaimStatus(
  userId: string,
  now = new Date(),
  db?: Database,
): Promise<StaffClaimStatus> {
  const database = db ?? getDb();
  recordPublicPoolSettingsPhysicalLoad();
  const settings = await getEffectiveSettings(database);

  const quotaLimit = settings.publicPoolClaimQuota7Days;
  const cooldownHours = settings.publicPoolClaimCooldownHours;

  const sevenDaysAgo = new Date(
    now.getTime() - CLAIM_QUOTA_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { claimedInLast7Days, lastClaimedAt } =
    await loadStaffClaimHistoryAggregate(database, userId, sevenDaysAgo);

  return buildStaffClaimStatusFromHistory({
    claimedInLast7Days,
    lastClaimedAt,
    quotaLimit,
    cooldownHours,
    now,
  });
}
