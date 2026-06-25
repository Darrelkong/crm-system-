"use client";

import { useTranslation } from "@/i18n/provider";
import { ImportCustomersClient } from "./import-customers-client";

export function ImportCustomersPageClient() {
  const { t } = useTranslation();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">{t("imports.customersTitle")}</h2>
        <p className="mt-1 text-sm text-slate-500">{t("imports.subtitle")}</p>
      </div>
      <ImportCustomersClient />
    </div>
  );
}
