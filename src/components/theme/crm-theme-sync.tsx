"use client";

import { useEffect } from "react";
import {
  applyCrmThemeToDocument,
  ensureCrmThemeOnDocument,
  useCrmTheme,
} from "@/lib/theme/crm-theme";

/** Subscribes to shared CRM theme store so document stays in sync after hydration. */
export function CrmThemeSync() {
  const theme = useCrmTheme();

  useEffect(() => {
    ensureCrmThemeOnDocument();
  }, []);

  useEffect(() => {
    applyCrmThemeToDocument(theme);
  }, [theme]);

  return null;
}
