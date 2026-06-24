import { and, desc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  CLAIM_COOLDOWN_MS,
  CLAIM_QUOTA_DAYS,
  CLAIM_QUOTA_MAX,
  type StaffClaimStatus,
} from "./constants";

export async function getStaffClaimStatus(
  userId: string,
  now = new Date(),
): Promise<StaffClaimStatus> {
  const db = getDb();
  const sevenDaysAgo = new Date(
    now.getTime() - CLAIM_QUOTA_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const recentClaims = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.claimedBy, userId),
        gte(schema.customers.claimedAt, sevenDaysAgo),
      ),
    );

  const claimedInLast7Days = recentClaims.length;
  const remainingQuota = Math.max(0, CLAIM_QUOTA_MAX - claimedInLast7Days);

  const lastClaimRows = await db
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
      new Date(lastClaimedAt).getTime() + CLAIM_COOLDOWN_MS,
    );
    if (cooldownEnd > now) {
      inCooldown = true;
      cooldownUntil = cooldownEnd.toISOString();
    }
  }

  let blockedReason: string | null = null;
  let canClaimNow = true;

  if (inCooldown) {
    canClaimNow = false;
    blockedReason = "当前处于领取冷却期，请稍后再试";
  } else if (remainingQuota <= 0) {
    canClaimNow = false;
    blockedReason = "7 天领取名额已达上限";
  }

  return {
    claimedInLast7Days,
    remainingQuota,
    cooldownUntil,
    inCooldown,
    canClaimNow,
    blockedReason,
  };
}
