import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { getEffectiveSettings } from "@/lib/settings/effective";

export const PUBLIC_POOL_FIRST_LOGIN_PROTECTION_DAYS = 45;
export const PUBLIC_POOL_FIRST_LOGIN_PROTECTION_MS =
  PUBLIC_POOL_FIRST_LOGIN_PROTECTION_DAYS * 24 * 60 * 60 * 1000;
/**
 * Existing accounts without reliable login history remain compatible. Accounts
 * created after this rollout remain protected until their first successful login.
 */
export const PUBLIC_POOL_ELIGIBILITY_ROLLOUT_AT =
  "2026-09-06T00:00:00.000Z";

export const PUBLIC_POOL_QUOTA_MIN = 0;
export const PUBLIC_POOL_QUOTA_MAX = 100;
export const PUBLIC_POOL_COOLDOWN_MIN_HOURS = 0;
export const PUBLIC_POOL_COOLDOWN_MAX_HOURS = 720;

export type PublicPoolMemberPolicy = {
  firstLoginAt: string | null;
  eligibilityAt: string | null;
  remainingProtectionDays: number;
  poolClaimPaused: boolean;
  quotaOverride: number | null;
  cooldownHoursOverride: number | null;
  effectiveQuota: number;
  effectiveCooldownHours: number;
  canClaimByMemberPolicy: boolean;
  blockedReasonKey: "adminPaused" | "newMemberProtection" | null;
};

export function validatePublicPoolPolicyOverride(
  quotaOverride: unknown,
  cooldownHoursOverride: unknown,
): { ok: true; quotaOverride: number | null; cooldownHoursOverride: number | null } | {
  ok: false;
  message: string;
} {
  const parseOptionalInteger = (
    value: unknown,
    min: number,
    max: number,
    label: string,
  ): number | null | string => {
    if (value === null || value === undefined || value === "") return null;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      return `${label} 超出允许范围`;
    }
    return value;
  };

  const quota = parseOptionalInteger(
    quotaOverride,
    PUBLIC_POOL_QUOTA_MIN,
    PUBLIC_POOL_QUOTA_MAX,
    "7 天领取配额",
  );
  if (typeof quota === "string") return { ok: false, message: quota };

  const cooldown = parseOptionalInteger(
    cooldownHoursOverride,
    PUBLIC_POOL_COOLDOWN_MIN_HOURS,
    PUBLIC_POOL_COOLDOWN_MAX_HOURS,
    "领取冷却",
  );
  if (typeof cooldown === "string") return { ok: false, message: cooldown };

  return {
    ok: true,
    quotaOverride: quota,
    cooldownHoursOverride: cooldown,
  };
}

export async function getPublicPoolMemberPolicy(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<PublicPoolMemberPolicy> {
  const [userRows, settings] = await Promise.all([
    db
      .select({
        firstLoginAt: schema.users.firstLoginAt,
        createdAt: schema.users.createdAt,
        role: schema.users.role,
        isActive: schema.users.isActive,
        poolClaimPaused: schema.users.poolClaimPaused,
        quotaOverride: schema.users.poolClaimQuotaOverride,
        cooldownHoursOverride: schema.users.poolClaimCooldownHoursOverride,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1),
    getEffectiveSettings(db),
  ]);

  const user = userRows[0];
  const firstLoginAt = user?.firstLoginAt ?? null;
  const createdAt = user?.createdAt ?? null;
  const eligibilityAt = firstLoginAt
    ? new Date(
        new Date(firstLoginAt).getTime() +
          PUBLIC_POOL_FIRST_LOGIN_PROTECTION_MS,
      ).toISOString()
    : null;
  const legacyCompatible =
    !firstLoginAt &&
    !!createdAt &&
    user?.role === "staff" &&
    user.isActive === 1 &&
    createdAt < PUBLIC_POOL_ELIGIBILITY_ROLLOUT_AT;
  const policyActive = now.toISOString() >= PUBLIC_POOL_ELIGIBILITY_ROLLOUT_AT;
  const protectedByFirstLogin =
    policyActive &&
    !legacyCompatible &&
    (!eligibilityAt || new Date(eligibilityAt).getTime() > now.getTime());
  const remainingProtectionDays = protectedByFirstLogin
    ? Math.max(
        1,
        Math.ceil(
          ((eligibilityAt
            ? new Date(eligibilityAt).getTime()
            : now.getTime() + PUBLIC_POOL_FIRST_LOGIN_PROTECTION_MS) -
            now.getTime()) /
            (24 * 60 * 60 * 1000),
        ),
      )
    : 0;
  const poolClaimPaused = user?.poolClaimPaused === 1;
  const blockedReasonKey = poolClaimPaused
    ? "adminPaused"
    : protectedByFirstLogin
      ? "newMemberProtection"
      : null;

  return {
    firstLoginAt,
    eligibilityAt,
    remainingProtectionDays,
    poolClaimPaused,
    quotaOverride: user?.quotaOverride ?? null,
    cooldownHoursOverride: user?.cooldownHoursOverride ?? null,
    effectiveQuota:
      user?.quotaOverride ?? settings.publicPoolClaimQuota7Days,
    effectiveCooldownHours:
      user?.cooldownHoursOverride ?? settings.publicPoolClaimCooldownHours,
    canClaimByMemberPolicy: blockedReasonKey === null,
    blockedReasonKey,
  };
}
