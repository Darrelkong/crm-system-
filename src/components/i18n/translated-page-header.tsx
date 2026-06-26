"use client";

import { useTranslation } from "@/i18n/provider";

export function TranslatedPageHeader({
  titleKey,
  descriptionKey,
  titleParams,
  descriptionParams,
  action,
}: {
  titleKey: string;
  descriptionKey?: string;
  titleParams?: Record<string, string>;
  descriptionParams?: Record<string, string>;
  action?: React.ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="page-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="page-title">{t(titleKey, titleParams)}</h1>
        {descriptionKey && (
          <p className="page-description">{t(descriptionKey, descriptionParams)}</p>
        )}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}
