/**
 * Former formal Phase 1 menu keys removed from the final 14-item menu.
 * Must not appear in the formal menu or custom-tag fallback selection.
 * Historical customers.source values remain readable via DB labels.
 */
export const RETIRED_FORMAL_SOURCE_KEYS = [
  "baidu_search",
  "baidu_maps",
  "baidu_baike",
  "haokan_video",
  "baidu_other",
  "weibo",
  "tencent_news",
  "sohu",
  "netease",
  "lofter",
  "sina",
  "ximalaya",
] as const;

export type RetiredFormalSourceKey =
  (typeof RETIRED_FORMAL_SOURCE_KEYS)[number];

const RETIRED_FORMAL_SOURCE_KEY_SET = new Set<string>(
  RETIRED_FORMAL_SOURCE_KEYS,
);

export function isRetiredFormalSourceKey(key: string): boolean {
  return RETIRED_FORMAL_SOURCE_KEY_SET.has(key);
}
