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
import {
  getCachedMessages,
  loadMessages,
} from "./load-messages";
import {
  shouldRenderTranslatedApp,
  shouldShowLocaleLoading,
  type LocaleCatalogStatus,
} from "./locale-catalog-state";
import { LocaleErrorShell } from "./locale-error-shell";
import { LocaleLoadingShell } from "./locale-loading-shell";
import { translate } from "./translate";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

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
  const [loadedLocale, setLoadedLocale] = useState<Locale | null>(null);
  const [status, setStatus] = useState<LocaleCatalogStatus>("loading");

  useEffect(() => {
    const stored = readStoredLocale();
    setLocaleState(stored);
    document.documentElement.lang = stored;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const targetLocale = locale;
    const cached = getCachedMessages(targetLocale);

    if (cached) {
      setMessages(cached);
      setLoadedLocale(targetLocale);
      setStatus("ready");
      return;
    }

    setStatus("loading");
    setLoadedLocale(null);
    setMessages(null);

    void loadMessages(targetLocale)
      .then((nextMessages) => {
        if (cancelled) {
          return;
        }
        setMessages(nextMessages);
        setLoadedLocale(targetLocale);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setMessages(null);
        setLoadedLocale(null);
        setStatus("error");
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
    (key: string, params?: Record<string, string>) => {
      if (!messages) {
        return key;
      }
      return translate(messages, key, params);
    },
    [messages],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  if (status === "error") {
    return <LocaleErrorShell />;
  }

  if (shouldShowLocaleLoading(status, locale, loadedLocale)) {
    return <LocaleLoadingShell />;
  }

  if (!shouldRenderTranslatedApp(status, locale, loadedLocale) || !messages) {
    return <LocaleLoadingShell />;
  }

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
