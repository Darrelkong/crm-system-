export const locales = ["zh-CN", "zh-TW", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh-CN";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
