type TranslateFn = (
  key: string,
  params?: Record<string, string>,
) => string;

export function resolveClaimBlockReason(
  t: TranslateFn,
  key: string | null | undefined,
  params?: Record<string, string>,
): string | null {
  if (!key) return null;
  const resolvedKey =
    key === "cooldown" && params?.hours
      ? "cooldownWithHours"
      : key === "quotaExceeded" && params?.limit
        ? "quotaExceededWithLimit"
        : key === "selfReleased" && params?.blockDays
          ? "selfReleasedWithinBlockWindow"
          : key;
  const fullKey = `publicPool.claimBlockReasons.${resolvedKey}`;
  const translated = t(fullKey, params);
  return translated === fullKey ? key : translated;
}
