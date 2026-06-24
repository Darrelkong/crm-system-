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

export function isCustomerSourceKey(value: string): value is CustomerSourceKey {
  return (CUSTOMER_SOURCE_KEYS as readonly string[]).includes(value);
}
