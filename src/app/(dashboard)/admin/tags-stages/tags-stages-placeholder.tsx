"use client";

import { EmptyState } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";

export function TagsStagesPlaceholder() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageIntro
        title={t("nav.tagsStages")}
        description={t("placeholders.tagsStagesDescription")}
      />
      <EmptyState message={t("placeholders.tagsStagesEmpty")} />
    </div>
  );
}
