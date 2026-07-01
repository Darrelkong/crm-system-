"use client";

import { SUPPORTED_LOCALES } from "@/i18n/config";
import { useTranslation } from "@/i18n/provider";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useTranslation();

  return (
    <label
      className={`inline-flex items-center gap-2 text-sm crm-text-secondary ${className ?? ""}`}
    >
      <span className="sr-only">{t("common.language")}</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as typeof locale)}
        className="surface-input px-2.5 py-1.5 text-sm shadow-sm"
        aria-label={t("common.language")}
      >
        {SUPPORTED_LOCALES.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}
