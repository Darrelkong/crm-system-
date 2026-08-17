"use client";

import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";
import { ImportCustomersClient } from "./import-customers-client";

type Props = {
  selectableSourceKeys: string[];
};

export function ImportCustomersPageClient({ selectableSourceKeys }: Props) {
  const { t } = useTranslation();
  const sampleKeys = selectableSourceKeys.slice(0, 6).join(", ");

  return (
    <div>
      <PageIntro
        title={t("imports.customersTitle")}
        description={t("imports.subtitle")}
      />
      <p className="mb-4 text-sm text-[#6B7890]">
        {t("imports.sourceKeyHelp", {
          count: String(selectableSourceKeys.length),
          sample: sampleKeys,
        })}
      </p>
      <ImportCustomersClient />
    </div>
  );
}
