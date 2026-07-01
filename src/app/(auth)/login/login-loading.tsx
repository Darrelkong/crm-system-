"use client";

import { T } from "@/components/i18n/t";
import { useCrmTheme } from "@/lib/theme/crm-theme";
import "./login-page.css";

export function LoginLoadingFallback() {
  const theme = useCrmTheme();

  return (
    <div
      className={`login-page__loading${
        theme === "dark" ? " login-page__loading--dark" : ""
      }`}
    >
      <T k="common.loading" />
    </div>
  );
}
