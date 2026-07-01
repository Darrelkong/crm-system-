"use client";

import { Moon, Sun } from "lucide-react";
import { useToggleCrmTheme } from "@/lib/theme/crm-theme";
import { cn } from "@/lib/cn";

type CrmThemeToggleProps = {
  className?: string;
};

export function CrmThemeToggle({ className }: CrmThemeToggleProps) {
  const [theme, toggleTheme] = useToggleCrmTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className={cn("crm-theme-toggle", className)}
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
    >
      <span className="crm-theme-toggle__track" data-active={isDark}>
        <span className="crm-theme-toggle__thumb">
          {isDark ? (
            <Moon className="crm-theme-toggle__icon" aria-hidden="true" />
          ) : (
            <Sun className="crm-theme-toggle__icon" aria-hidden="true" />
          )}
        </span>
      </span>
    </button>
  );
}
