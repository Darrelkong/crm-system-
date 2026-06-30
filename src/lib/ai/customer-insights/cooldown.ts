/** Minimum interval between AI insight refreshes for the same customer. */
export const AI_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

export type AiRefreshCooldownInsight = {
  generatedAt: string;
} | null;

export function isAiRefreshOnCooldown(
  existingInsight: AiRefreshCooldownInsight,
  nowMs: number = Date.now(),
): boolean {
  if (!existingInsight) {
    return false;
  }

  const generatedAtMs = Date.parse(existingInsight.generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    return false;
  }

  return nowMs - generatedAtMs < AI_REFRESH_COOLDOWN_MS;
}

export function msUntilAiRefreshAllowed(
  existingInsight: AiRefreshCooldownInsight,
  nowMs: number = Date.now(),
): number {
  if (!existingInsight) {
    return 0;
  }

  const generatedAtMs = Date.parse(existingInsight.generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    return 0;
  }

  return Math.max(0, AI_REFRESH_COOLDOWN_MS - (nowMs - generatedAtMs));
}
