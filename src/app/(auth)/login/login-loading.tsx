"use client";

import { useEffect } from "react";
import { T } from "@/components/i18n/t";
import { applyCrmThemeToDocument, useCrmTheme } from "@/lib/theme/crm-theme";
import "./login-page.css";

export function LoginLoadingFallback() {
  const theme = useCrmTheme();

  useEffect(() => {
    applyCrmThemeToDocument(theme, "/login");
  }, [theme]);

  return (
    <div
      className={`login-page__loading${
        theme === "dark" ? " login-page__loading--dark" : ""
      }`}
    >
      {theme === "dark" && (
        <>
          <div
            className="login-page__safe-area login-page__safe-area--top"
            aria-hidden="true"
          />
          <div
            className="login-page__safe-area login-page__safe-area--bottom"
            aria-hidden="true"
          />
        </>
      )}
      <T k="common.loading" />
    </div>
  );
}
