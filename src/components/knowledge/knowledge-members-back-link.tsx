"use client";

import { useTranslation } from "@/i18n/provider";
import { KnowledgeBackLink } from "@/components/knowledge/knowledge-back-link";

export function KnowledgeMembersBackLink() {
  const { t } = useTranslation();
  return (
    <KnowledgeBackLink href="/knowledge">
      {t("knowledge.members.backToKnowledge")}
    </KnowledgeBackLink>
  );
}
