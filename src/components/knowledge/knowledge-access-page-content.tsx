"use client";

import { useTranslation } from "@/i18n/provider";
import { KnowledgeAccessForm } from "@/components/knowledge/knowledge-access-form";

export function KnowledgeAccessPageContent({
  initialized,
}: {
  initialized: boolean;
}) {
  const { t } = useTranslation();

  if (!initialized) {
    return (
      <div className="surface-card max-w-xl p-6">
        <p className="text-sm crm-text-secondary">
          {t("knowledge.accessUninitializedNotice")}
        </p>
      </div>
    );
  }

  return (
    <div className="surface-card max-w-xl p-6">
      <p className="text-sm crm-text-secondary">{t("knowledge.accessNotice")}</p>
      <div className="mt-6">
        <KnowledgeAccessForm />
      </div>
    </div>
  );
}
