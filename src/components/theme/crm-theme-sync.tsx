"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  applyCrmThemeToDocument,
  ensureCrmThemeOnDocument,
  useCrmTheme,
} from "@/lib/theme/crm-theme";

/** Subscribes to shared CRM theme store so document stays in sync after hydration. */
export function CrmThemeSync() {
  const theme = useCrmTheme();
  const pathname = usePathname();

  useEffect(() => {
    ensureCrmThemeOnDocument(pathname);
  }, [pathname]);

  useEffect(() => {
    applyCrmThemeToDocument(theme, pathname);
  }, [theme, pathname]);

  return null;
}
