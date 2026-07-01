"use client";

import { Moon, Sun } from "lucide-react";

export const LOGIN_THEME_STORAGE_KEY = "crm-login-theme";

export type LoginTheme = "light" | "dark";

export function readStoredLoginTheme(): LoginTheme {
  if (typeof window === "undefined") {
    return "light";
  }
  return localStorage.getItem(LOGIN_THEME_STORAGE_KEY) === "dark"
    ? "dark"
    : "light";
}

type LoginThemeToggleProps = {
  theme: LoginTheme;
  onToggle: () => void;
  themeReady?: boolean;
};

export function LoginThemeToggle({
  theme,
  onToggle,
  themeReady = false,
}: LoginThemeToggleProps) {
  const isDark = themeReady && theme === "dark";

  return (
    <button
      type="button"
      className="login-page__theme-toggle"
      onClick={onToggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
    >
      <span className="login-page__theme-toggle-track" data-active={isDark}>
        <span className="login-page__theme-toggle-thumb">
          {isDark ? (
            <Moon className="login-page__theme-toggle-icon" aria-hidden="true" />
          ) : (
            <Sun className="login-page__theme-toggle-icon" aria-hidden="true" />
          )}
        </span>
      </span>
    </button>
  );
}
