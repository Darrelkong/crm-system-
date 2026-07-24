/** Minimum interval between AI insight refreshes for the same customer. */
export const AI_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Cooldown applies only after a successful ready insight for that customer.
 * Failed / placeholder rows must not block refresh (including the openai
 * pre-write used for Error 1102 soft protection).
 */
export type AiRefreshCooldownInsight = {
  generatedAt: string;
  /** When omitted, treated as ready for backward-compatible unit fixtures. */
  status?: string | null;
} | null;

export function isAiRefreshOnCooldown(
  existingInsight: AiRefreshCooldownInsight,
  nowMs: number = Date.now(),
): boolean {
  if (!existingInsight) {
    return false;
  }

  const status = existingInsight.status ?? "ready";
  if (status !== "ready") {
    return false;
  }

  const generatedAtMs = Date.parse(existingInsight.generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    return false;
  }

  // Future timestamps must never create a permanent lock.
  if (generatedAtMs > nowMs) {
    return false;
  }

  return nowMs - generatedAtMs < AI_REFRESH_COOLDOWN_MS;
}

export function msUntilAiRefreshAllowed(
  existingInsight: AiRefreshCooldownInsight,
  nowMs: number = Date.now(),
): number {
  if (!isAiRefreshOnCooldown(existingInsight, nowMs)) {
    return 0;
  }

  const generatedAtMs = Date.parse(existingInsight!.generatedAt);
  return Math.max(0, AI_REFRESH_COOLDOWN_MS - (nowMs - generatedAtMs));
}
