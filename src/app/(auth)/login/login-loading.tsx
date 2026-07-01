"use client";

import { useEffect, useState } from "react";
import { T } from "@/components/i18n/t";
import {
  readStoredLoginTheme,
  type LoginTheme,
} from "@/app/(auth)/login/login-theme-toggle";
import "./login-page.css";

export function LoginLoadingFallback() {
  const [theme, setTheme] = useState<LoginTheme>("light");

  useEffect(() => {
    setTheme(readStoredLoginTheme());
  }, []);

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
