import * as React from "react";

type Translate = (key: string, params?: Record<string, string>) => string;

/** Historical AI fields stay available without competing with human S/A/B/D. */
export function CustomerAiRatingReference({ t, intentLabel, intentScore, riskFlags }: {
  t: Translate; intentLabel: string; intentScore: number; riskFlags: string[];
}) {
  return <section className="space-y-2" data-testid="ai-rating-reference">
    <p className="text-xs crm-text-muted">{t("customerRating.aiReferenceNotice")}</p>
    <details className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
      <summary className="cursor-pointer text-sm crm-text-secondary">{t("customerRating.aiReference")}</summary>
      <dl className="mt-3 space-y-2 text-sm crm-text-muted">
        <div><dt>{t("customers.aiInsight.intentLevel")}</dt><dd>{intentLabel}</dd></div>
        <div><dt>{t("customers.aiInsight.intentScore")}</dt><dd>{intentScore}</dd></div>
      </dl>
      <p className="mt-3 text-xs font-medium crm-text-muted">{t("customers.aiInsight.riskFlags")}</p>
      {riskFlags.length > 0 ? <ul className="mt-1 list-inside list-disc text-sm crm-text-muted">
        {riskFlags.map((flag, i) => <li key={i} className="break-words">{flag}</li>)}
      </ul> : <p className="text-sm crm-text-muted">{t("customers.aiInsight.noRiskFlags")}</p>}
    </details>
  </section>;
}
