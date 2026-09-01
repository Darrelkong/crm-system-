import type { Locale } from "./config";
import type { Messages } from "./locales/en";

export const LOCALE_JSON_PATH: Record<Locale, string> = {
  en: "/locales/en.json",
  "zh-Hans": "/locales/zh-Hans.json",
  "zh-Hant": "/locales/zh-Hant.json",
};

const localeMessageCache = new Map<Locale, Messages>();

export function getCachedMessages(locale: Locale): Messages | undefined {
  return localeMessageCache.get(locale);
}

export function clearLocaleMessageCache(): void {
  localeMessageCache.clear();
}

export function primeLocaleMessageCache(
  locale: Locale,
  messages: Messages,
): void {
  localeMessageCache.set(locale, messages);
}

export async function loadMessages(
  locale: Locale,
  fetchImpl: typeof fetch = fetch,
): Promise<Messages> {
  const cached = localeMessageCache.get(locale);
  if (cached) {
    return cached;
  }

  const response = await fetchImpl(LOCALE_JSON_PATH[locale], {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to load locale: ${locale}`);
  }

  let messages: Messages;
  try {
    messages = (await response.json()) as Messages;
  } catch {
    throw new Error(`Invalid locale JSON: ${locale}`);
  }

  if (!messages || typeof messages !== "object") {
    throw new Error(`Invalid locale JSON: ${locale}`);
  }

  localeMessageCache.set(locale, messages);
  return messages;
}
