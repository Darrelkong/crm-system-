"use client";

import { SUPPORTED_LOCALES } from "@/i18n/config";
import { useTranslation } from "@/i18n/provider";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useTranslation();

  return (
    <label
      className={`inline-flex items-center gap-2 text-sm text-slate-600 ${className ?? ""}`}
    >
      <span className="sr-only">{t("common.language")}</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as typeof locale)}
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
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
