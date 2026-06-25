import { and, desc, eq, gte } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { CLAIM_QUOTA_DAYS, type StaffClaimStatus } from "./constants";

export async function getStaffClaimStatus(
  userId: string,
  now = new Date(),
  db?: Database,
): Promise<StaffClaimStatus> {
  const database = db ?? getDb();
  const settings = await getEffectiveSettings(database);

  const quotaLimit = settings.publicPoolClaimQuota7Days;
  const cooldownHours = settings.publicPoolClaimCooldownHours;
  const cooldownMs = cooldownHours * 60 * 60 * 1000;

  const sevenDaysAgo = new Date(
    now.getTime() - CLAIM_QUOTA_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const recentClaims = await database
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.claimedBy, userId),
        gte(schema.customers.claimedAt, sevenDaysAgo),
      ),
    );

  const claimedInLast7Days = recentClaims.length;
  const remainingQuota = Math.max(0, quotaLimit - claimedInLast7Days);

  const lastClaimRows = await database
    .select({ claimedAt: schema.customers.claimedAt })
    .from(schema.customers)
    .where(eq(schema.customers.claimedBy, userId))
    .orderBy(desc(schema.customers.claimedAt))
    .limit(1);

  let cooldownUntil: string | null = null;
  let inCooldown = false;

  const lastClaimedAt = lastClaimRows[0]?.claimedAt;
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
