"use client";

import { useTranslation } from "@/i18n/provider";
import { KnowledgeAccessForm } from "@/components/knowledge/knowledge-access-form";

export function KnowledgeSetupPageContent() {
  const { t } = useTranslation();

  return (
    <div className="surface-card max-w-xl p-6">
      <p className="text-sm crm-text-secondary">{t("knowledge.setupNotice")}</p>
      <div className="mt-6">
        <KnowledgeAccessForm setup />
      </div>
    </div>
  );
}
