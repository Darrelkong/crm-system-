"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  type Locale,
  isLocale,
} from "./config";
import type { Messages } from "./locales/en";
import { translate } from "./translate";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const localeJsonPath: Record<Locale, string> = {
  en: "/locales/en.json",
  "zh-Hans": "/locales/zh-Hans.json",
  "zh-Hant": "/locales/zh-Hant.json",
};

const localeMessageCache = new Map<Locale, Messages>();

async function loadMessages(locale: Locale): Promise<Messages> {
  const cached = localeMessageCache.get(locale);
  if (cached) {
    return cached;
  }

  const response = await fetch(localeJsonPath[locale]);
  if (!response.ok) {
    throw new Error(`Failed to load locale: ${locale}`);
  }
  const messages = (await response.json()) as Messages;
  localeMessageCache.set(locale, messages);
  return messages;
}

function readStoredLocale(): Locale {
  if (typeof window === "undefined") {
    return DEFAULT_LOCALE;
  }
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && isLocale(stored)) {
      return stored;
    }
  } catch {
    // ignore
  }
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    typeof window !== "undefined" ? readStoredLocale() : DEFAULT_LOCALE,
  );
  const [messages, setMessages] = useState<Messages | null>(null);

  useEffect(() => {
    const stored = readStoredLocale();
    setLocaleState(stored);
    document.documentElement.lang = stored;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadMessages(locale).then((nextMessages) => {
      if (!cancelled) {
        setMessages(nextMessages);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // ignore
    }
    document.documentElement.lang = next;
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string>) =>
      translate(messages ?? ({} as Messages), key, params),
    [messages],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return (
    <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within I18nProvider");
  }
  return ctx;
}
