export const RECYCLE_BIN_RETENTION_DAYS = 90;
export const RECYCLE_BIN_PURGE_BATCH_SIZE = 50;

/** UTC ISO timestamp: customers with deleted_at strictly before this are eligible for purge. */
export function getRecycleBinRetentionCutoffIso(now: Date = new Date()): string {
  return new Date(
    now.getTime() - RECYCLE_BIN_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export function isRecycleBinRetentionExpired(
  deletedAt: string,
  now: Date = new Date(),
): boolean {
  return deletedAt < getRecycleBinRetentionCutoffIso(now);
}
