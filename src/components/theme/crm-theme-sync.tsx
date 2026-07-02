"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  applyCrmThemeToDocument,
  ensureCrmThemeOnDocument,
  startCrmThemeMetaGuard,
  useCrmTheme,
} from "@/lib/theme/crm-theme";

/** Subscribes to shared CRM theme store so document stays in sync after hydration. */
export function CrmThemeSync() {
  const theme = useCrmTheme();
  const pathname = usePathname();
  const stateRef = useRef({ theme, pathname });

  stateRef.current = { theme, pathname };

  useEffect(() => {
    startCrmThemeMetaGuard(() => stateRef.current);
  }, []);

  useEffect(() => {
    ensureCrmThemeOnDocument(pathname);
  }, [pathname]);

  useEffect(() => {
    applyCrmThemeToDocument(theme, pathname);
  }, [theme, pathname]);

  return null;
}
