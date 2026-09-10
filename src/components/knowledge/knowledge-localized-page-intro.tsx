"use client";

import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";

export function KnowledgeLocalizedPageIntro({
  titleKey,
  descriptionKey,
  action,
  hideOnMobile = false,
}: {
  titleKey: string;
  descriptionKey?: string;
  action?: React.ReactNode;
  hideOnMobile?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <PageIntro
      className={hideOnMobile ? "hidden md:flex" : undefined}
      title={t(titleKey)}
      description={descriptionKey ? t(descriptionKey) : undefined}
      action={action}
      compact={hideOnMobile}
    />
  );
}
