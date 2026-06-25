"use client";

import { useTranslation } from "@/i18n/provider";

export function T({
  k,
  params,
}: {
  k: string;
  params?: Record<string, string>;
}) {
  const { t } = useTranslation();
  return <>{t(k, params)}</>;
}
