import {
  INTERNAL_CUSTOMER_SOURCE_KEYS,
  PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY,
} from "@/lib/constants/customer-sources";

/** Keys that must never be selected for new customers but remain readable. */
export const LEGACY_HIDDEN_SOURCE_KEYS = ["online_media"] as const;

export const INTERNAL_READABLE_SOURCE_KEYS = [
  ...INTERNAL_CUSTOMER_SOURCE_KEYS,
  "missing_primary_backfill",
] as const;

/**
 * Fallback labels when no customer_tags row exists.
 * Must NOT override an existing DB label.
 */
export const INTERNAL_SOURCE_LABEL_FALLBACKS: Record<string, string> = {
  [PUBLIC_POOL_QUICK_ENTRY_SOURCE_KEY]: "公共池快速录入（历史）",
  missing_primary_backfill: "缺失主负责人回填",
};

export function isLegacyHiddenSourceKey(key: string): boolean {
  return (LEGACY_HIDDEN_SOURCE_KEYS as readonly string[]).includes(key);
}

export function isInternalReadableSourceKey(key: string): boolean {
  return (INTERNAL_READABLE_SOURCE_KEYS as readonly string[]).includes(key);
}

export function isWritableInternalSourceKey(key: string): boolean {
  return (INTERNAL_CUSTOMER_SOURCE_KEYS as readonly string[]).includes(key)
    || key === "missing_primary_backfill";
}
