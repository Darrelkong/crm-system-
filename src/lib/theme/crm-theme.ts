"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  CRM_THEME_COLOR_DARK,
  CRM_THEME_COLOR_LIGHT,
  CRM_THEME_STORAGE_KEY,
} from "@/lib/theme/crm-theme-bootstrap";

export { CRM_THEME_STORAGE_KEY } from "@/lib/theme/crm-theme-bootstrap";

export type CrmTheme = "light" | "dark";

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

export function applyCrmThemeToDocument(theme: CrmTheme): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  const color =
    theme === "dark" ? CRM_THEME_COLOR_DARK : CRM_THEME_COLOR_LIGHT;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", color);
}

export function writeCrmTheme(theme: CrmTheme): void {
  try {
    window.localStorage.setItem(CRM_THEME_STORAGE_KEY, theme);
  } catch {
    // ignore quota / private mode
  }

  themeStoreValue = theme;
  themeStoreReady = true;
  applyCrmThemeToDocument(theme);

  for (const listener of themeListeners) {
    listener();
  }
}

export function toggleCrmTheme(): CrmTheme {
  const next: CrmTheme = getThemeSnapshot() === "dark" ? "light" : "dark";
  writeCrmTheme(next);
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
    if (document.documentElement.getAttribute("data-theme") !== stored) {
      applyCrmThemeToDocument(stored);
    }
  }
  return themeStoreValue;
}

/** Re-read storage and sync DOM — used after hydration when data-theme may be cleared. */
export function ensureCrmThemeOnDocument(): CrmTheme {
  const theme = readCrmTheme();
  themeStoreValue = theme;
  themeStoreReady = true;
  applyCrmThemeToDocument(theme);
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

export function useToggleCrmTheme(): [CrmTheme, () => void] {
  const theme = useCrmTheme();
  const toggle = useCallback(() => {
    writeCrmTheme(theme === "light" ? "dark" : "light");
  }, [theme]);
  return [theme, toggle];
}
