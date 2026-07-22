/** Stable English keys stored in the database. */
export const CUSTOMER_SOURCE_KEYS = [
  "xianyu_taobao",
  "xiaohongshu",
  "douyin",
  "referral",
  "online_media",
  "agent_client",
  "other",
] as const;

export type CustomerSourceKey = (typeof CUSTOMER_SOURCE_KEYS)[number];

export const CUSTOMER_SOURCE_OTHER_KEY: CustomerSourceKey = "other";

/**
 * Server-only source keys. Never listed in ordinary create/import selectors.
 * Must not be added to CUSTOMER_SOURCE_KEYS.
 */
export const PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY =
  "public_pool_quick_entry" as const;

export const INTERNAL_CUSTOMER_SOURCE_KEYS = [
  PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY,
] as const;

export type InternalCustomerSourceKey =
  (typeof INTERNAL_CUSTOMER_SOURCE_KEYS)[number];

export function isCustomerSourceKey(value: string): value is CustomerSourceKey {
  return (CUSTOMER_SOURCE_KEYS as readonly string[]).includes(value);
}

export function isInternalCustomerSourceKey(
  value: string,
): value is InternalCustomerSourceKey {
  return (INTERNAL_CUSTOMER_SOURCE_KEYS as readonly string[]).includes(value);
}
