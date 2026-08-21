/** V1 frozen bounds for local / future mail-jobs-cron background tick. */
export const MAIL_BACKGROUND_MAX_ITEMS_PER_CATEGORY = 5 as const;

export const MAIL_BACKGROUND_MAX_TOTAL_ITEMS_PER_TICK = 20 as const;

export const MAIL_BACKGROUND_SOFT_WALL_CLOCK_BUDGET_MS = 25_000 as const;

/** Delivery correlation dependency temporarily unavailable — retry after 15 minutes. */
export const DELIVERY_CORRELATION_RETRY_DELAY_MS = 15 * 60 * 1000;

export function computeDeliveryCorrelationRetryAfter(trustNow: string): string {
  return new Date(
    Date.parse(trustNow) + DELIVERY_CORRELATION_RETRY_DELAY_MS,
  ).toISOString();
}
