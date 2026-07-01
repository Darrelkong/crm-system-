"use client";

import { Moon, Sun } from "lucide-react";
import type { CrmTheme } from "@/lib/theme/crm-theme";

export {
  CRM_THEME_STORAGE_KEY as LOGIN_THEME_STORAGE_KEY,
  readCrmTheme as readStoredLoginTheme,
  type CrmTheme as LoginTheme,
} from "@/lib/theme/crm-theme";

type LoginThemeToggleProps = {
  theme: CrmTheme;
  onToggle: () => void;
};

export function LoginThemeToggle({ theme, onToggle }: LoginThemeToggleProps) {
  const isDark = theme === "dark";

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
