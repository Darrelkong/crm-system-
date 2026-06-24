export const CLAIM_QUOTA_DAYS = 7;

/** @deprecated Use system_settings via getEffectiveSettings() */
export const CLAIM_QUOTA_MAX = 5;
/** @deprecated Use system_settings via getEffectiveSettings() */
export const CLAIM_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export type StaffClaimStatus = {
  claimedInLast7Days: number;
  remainingQuota: number;
  quotaLimit: number;
  cooldownHours: number;
  cooldownUntil: string | null;
  inCooldown: boolean;
  canClaimNow: boolean;
  blockedReason: string | null;
};

export type AdminClaimStatus = {
  unlimited: true;
  canClaimNow: true;
  claimedInLast7Days: null;
  remainingQuota: null;
  cooldownUntil: null;
  blockedReason: null;
};
