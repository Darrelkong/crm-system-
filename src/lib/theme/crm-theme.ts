"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  CRM_THEME_COLOR_DARK,
  CRM_THEME_STORAGE_KEY,
  isLoginPathname,
  resolveCrmThemeColor,
  setCrmThemeColorMeta,
} from "@/lib/theme/crm-theme-bootstrap";

export {
  CRM_THEME_COLOR_DARK,
  CRM_THEME_COLOR_LIGHT,
  CRM_THEME_COLOR_LOGIN_LIGHT,
} from "@/lib/theme/crm-theme-bootstrap";

export { CRM_THEME_STORAGE_KEY } from "@/lib/theme/crm-theme-bootstrap";

export type CrmTheme = "light" | "dark";

function readPathname(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.location.pathname;
}

function readThemeColorMeta(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  return (
    document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ??
    null
  );
}

function documentNeedsThemeSync(
  theme: CrmTheme,
  pathname?: string | null,
): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const path = pathname ?? readPathname();
  const expectedColor = resolveCrmThemeColor(theme, path);
  const root = document.documentElement;

  return (
    root.getAttribute("data-theme") !== theme ||
    root.style.colorScheme !== theme ||
    readThemeColorMeta() !== expectedColor
  );
}

export function readCrmTheme(): CrmTheme {
  if (typeof window === "undefined") {
    return "light";
  }
  try {
    return window.localStorage.getItem(CRM_THEME_STORAGE_KEY) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export function applyCrmThemeToDocument(
  theme: CrmTheme,
  pathname?: string | null,
): void {
  if (typeof document === "undefined") {
    return;
  }

  const path = pathname ?? readPathname();
  const color = resolveCrmThemeColor(theme, path);

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  setCrmThemeColorMeta(color);
  document.documentElement.style.backgroundColor = color;
  document.body.style.backgroundColor = color;
}

export function writeCrmTheme(
  theme: CrmTheme,
  pathname?: string | null,
): void {
  try {
    window.localStorage.setItem(CRM_THEME_STORAGE_KEY, theme);
  } catch {
    // ignore quota / private mode
  }

  themeStoreValue = theme;
  themeStoreReady = true;
  applyCrmThemeToDocument(theme, pathname);

  for (const listener of themeListeners) {
    listener();
  }
}

export function toggleCrmTheme(pathname?: string | null): CrmTheme {
  const next: CrmTheme = getThemeSnapshot() === "dark" ? "light" : "dark";
  writeCrmTheme(next, pathname);
  return next;
}

let themeStoreValue: CrmTheme = "light";
let themeStoreReady = false;
const themeListeners = new Set<() => void>();

function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

function getThemeSnapshot(): CrmTheme {
  if (typeof window !== "undefined") {
    const stored = readCrmTheme();
    themeStoreValue = stored;
    themeStoreReady = true;
    if (documentNeedsThemeSync(stored)) {
      applyCrmThemeToDocument(stored);
    }
  }
  return themeStoreValue;
}

/** Re-read storage and sync DOM — used after hydration when data-theme may be cleared. */
export function ensureCrmThemeOnDocument(pathname?: string | null): CrmTheme {
  const theme = readCrmTheme();
  themeStoreValue = theme;
  themeStoreReady = true;
  applyCrmThemeToDocument(theme, pathname);
  return theme;
}

function getThemeServerSnapshot(): CrmTheme {
  return "light";
}

export function useCrmTheme(): CrmTheme {
  return useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeServerSnapshot,
  );
}

export function useToggleCrmTheme(
  pathname?: string | null,
): [CrmTheme, () => void] {
  const theme = useCrmTheme();
  const path = pathname ?? readPathname();
  const toggle = useCallback(() => {
    writeCrmTheme(theme === "light" ? "dark" : "light", path);
  }, [theme, path]);
  return [theme, toggle];
}

export { isLoginPathname };
