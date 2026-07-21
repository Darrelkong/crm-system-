export const CLAIM_QUOTA_DAYS = 7;

/** Staff cannot reclaim a client they released within this many days after pool entry. */
export const SELF_RELEASE_CLAIM_BLOCK_DAYS = 7;

/**
 * Oldest claimable public-pool customers considered for staff random claim.
 * Fixed for v1 — not a system setting and not client-controlled.
 */
export const RANDOM_CLAIM_CANDIDATE_BATCH_SIZE = 10;

/** Internal page size while scanning pool rows for self-release filtering. */
export const RANDOM_CLAIM_CANDIDATE_SCAN_PAGE_SIZE = 30;

/** Safety cap on rows scanned while filling a random-claim candidate batch. */
export const RANDOM_CLAIM_CANDIDATE_MAX_SCAN_ROWS = 300;

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
  blockedReasonKey: string | null;
  blockedReasonParams?: Record<string, string>;
};

export type AdminClaimStatus = {
  unlimited: true;
  canClaimNow: true;
  claimedInLast7Days: null;
  remainingQuota: null;
  cooldownUntil: null;
  blockedReasonKey: null;
};
