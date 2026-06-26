"use client";

import { T } from "@/components/i18n/t";
import "./login-page.css";

export function LoginLoadingFallback() {
  return (
    <div className="login-page__loading">
      <T k="common.loading" />
    </div>
  );
}
