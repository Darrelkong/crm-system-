export const IDLE_TIMEOUT_SETTING_KEY = "inactivity_logout_minutes" as const;

export const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;
export const MIN_IDLE_TIMEOUT_MINUTES = 5;
export const MAX_IDLE_TIMEOUT_MINUTES = 1440;

export function isValidIdleTimeoutMinutes(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= MIN_IDLE_TIMEOUT_MINUTES &&
    value <= MAX_IDLE_TIMEOUT_MINUTES
  );
}

/**
 * Normalize a stored setting to the safe CRM default when it is missing or
 * outside the supported range.
 */
export function parseIdleTimeoutMinutes(
  raw: string | number | null | undefined,
): number {
  const value =
    typeof raw === "number"
      ? raw
      : raw != null && /^\d+$/.test(raw.trim())
        ? Number(raw.trim())
        : Number.NaN;
  return isValidIdleTimeoutMinutes(value)
    ? value
    : DEFAULT_IDLE_TIMEOUT_MINUTES;
}
