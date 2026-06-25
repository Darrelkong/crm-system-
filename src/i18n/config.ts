export const LOCALE_STORAGE_KEY = "crm_locale";

export const DEFAULT_LOCALE = "en" as const;

export const SUPPORTED_LOCALES = [
  { code: "en", label: "English" },
  { code: "zh-Hant", label: "繁體中文" },
  { code: "zh-Hans", label: "简体中文" },
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number]["code"];

export const locales = SUPPORTED_LOCALES.map((l) => l.code) as Locale[];

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

/** @deprecated Use DEFAULT_LOCALE */
export const defaultLocale: Locale = DEFAULT_LOCALE;
