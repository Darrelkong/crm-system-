"use client";

import { useTranslation } from "@/i18n/provider";
import { KnowledgeBackLink } from "@/components/knowledge/knowledge-back-link";

export function KnowledgeBackLinkLocalized({
  href,
  labelKey,
}: {
  href: string;
  labelKey: string;
}) {
  const { t } = useTranslation();
  return <KnowledgeBackLink href={href}>{t(labelKey)}</KnowledgeBackLink>;
}
