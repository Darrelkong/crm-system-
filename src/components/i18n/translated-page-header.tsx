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
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {t(titleKey, titleParams)}
        </h1>
        {descriptionKey && (
          <p className="mt-1 text-sm text-slate-500">
            {t(descriptionKey, descriptionParams)}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
