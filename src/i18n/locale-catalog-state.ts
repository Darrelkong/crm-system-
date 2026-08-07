import type { Locale } from "./config";

export type LocaleCatalogStatus = "loading" | "ready" | "error";

export function shouldRenderTranslatedApp(
  status: LocaleCatalogStatus,
  locale: Locale,
  loadedLocale: Locale | null,
): boolean {
  return status === "ready" && loadedLocale === locale;
}

export function shouldShowLocaleLoading(
  status: LocaleCatalogStatus,
  locale: Locale,
  loadedLocale: Locale | null,
): boolean {
  return status === "loading" || (status === "ready" && loadedLocale !== locale);
}
