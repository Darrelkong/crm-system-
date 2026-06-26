"use client";

import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";
import { ImportCustomersClient } from "./import-customers-client";

export function ImportCustomersPageClient() {
  const { t } = useTranslation();

  return (
    <div>
      <PageIntro
        title={t("imports.customersTitle")}
        description={t("imports.subtitle")}
      />
      <ImportCustomersClient />
    </div>
  );
}
