import type { Locale } from "./config";
import type { Messages } from "./locales/en";
import en from "./locales/en";
import zhHans from "./locales/zh-Hans";
import zhHant from "./locales/zh-Hant";

const catalogs: Record<Locale, Messages> = {
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
};

export function getMessages(locale: Locale): Messages {
  return catalogs[locale] ?? catalogs.en;
}

export type { Messages };
